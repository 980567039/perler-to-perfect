/// <reference lib="webworker" />

import { GENERATION_SAMPLE_SCALE, GenerationCancelledError, generatePattern } from '../domain/generation';
import type { GenerateRequest, GenerateResponse, GenerationSettings } from '../domain/types';

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const cancelledJobs = new Set<string>();

function post(message: GenerateResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function drawSampledImage(bitmap: ImageBitmap, settings: GenerationSettings): ImageData {
  const width = settings.grid.columns * GENERATION_SAMPLE_SCALE;
  const height = settings.grid.rows * GENERATION_SAMPLE_SCALE;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建离屏画布。');

  // Keep letterbox/crop margins transparent. Transparent samples become EMPTY
  // cells in the generator instead of being mistaken for white beads.
  context.clearRect(0, 0, width, height);

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  const cropBox = settings.cropBox;
  if (cropBox && settings.fit === 'crop') {
    // The crop box is expressed in preview/grid coordinates. Apply the same
    // crop-mode transform as the preview before mapping the selected region.
    const baseScale = Math.max(width / bitmap.width, height / bitmap.height);
    const scale = baseScale * Math.max(0.05, settings.transform.scale);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    const drawX = (width - drawWidth) / 2 + settings.transform.offsetX;
    const drawY = (height - drawHeight) / 2 + settings.transform.offsetY;
    const sourceX = (cropBox.x * width - drawX) / scale;
    const sourceY = (cropBox.y * height - drawY) / scale;
    const sourceWidth = (cropBox.width * width) / scale;
    const sourceHeight = (cropBox.height * height) / scale;
    const sx = clamp(sourceX, 0, bitmap.width);
    const sy = clamp(sourceY, 0, bitmap.height);
    const ex = clamp(sourceX + sourceWidth, 0, bitmap.width);
    const ey = clamp(sourceY + sourceHeight, 0, bitmap.height);
    const sw = Math.max(1, ex - sx);
    const sh = Math.max(1, ey - sy);
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  } else {
    const baseScale =
      settings.fit === 'contain'
        ? Math.min(width / bitmap.width, height / bitmap.height)
        : Math.max(width / bitmap.width, height / bitmap.height);
    const scale = baseScale * Math.max(0.05, settings.transform.scale);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    const drawX = (width - drawWidth) / 2 + settings.transform.offsetX;
    const drawY = (height - drawHeight) / 2 + settings.transform.offsetY;
    context.drawImage(bitmap, drawX, drawY, drawWidth, drawHeight);
  }

  return context.getImageData(0, 0, width, height);
}

workerScope.onmessage = (event: MessageEvent<GenerateRequest>) => {
  const request = event.data;
  if (request.type === 'CANCEL') {
    cancelledJobs.add(request.jobId);
    return;
  }

  const { jobId, bitmap, palette, settings } = request;
  cancelledJobs.delete(jobId);
  try {
    post({ type: 'PROGRESS', jobId, stage: 'prepare', completed: 0, total: 1 });
    const sampledImage = drawSampledImage(bitmap, settings);
    bitmap.close();
    post({ type: 'PROGRESS', jobId, stage: 'prepare', completed: 1, total: 1 });
    const result = generatePattern(sampledImage, palette, settings, {
      isCancelled: () => cancelledJobs.has(jobId),
      onProgress: (progress) => post({ type: 'PROGRESS', jobId, ...progress }),
    });
    const cellsBuffer = result.cells.buffer as ArrayBuffer;
    post(
      {
        type: 'RESULT',
        jobId,
        grid: result.grid,
        cells: cellsBuffer,
        counts: result.counts,
        totalBeads: result.totalBeads,
        selectedPaletteIndices: result.selectedPaletteIndices,
      },
      [cellsBuffer],
    );
  } catch (error) {
    bitmap.close();
    const cancelled = error instanceof GenerationCancelledError || cancelledJobs.has(jobId);
    post({
      type: 'ERROR',
      jobId,
      code: cancelled ? 'GENERATION_CANCELLED' : 'GENERATION_FAILED',
      message: error instanceof Error ? error.message : '生成失败。',
    });
  } finally {
    cancelledJobs.delete(jobId);
  }
};

export {};
