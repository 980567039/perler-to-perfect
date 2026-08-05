/// <reference lib="webworker" />

import { GENERATION_SAMPLE_SCALE, GenerationCancelledError, generatePattern } from '../domain/generation';
import type { GenerateRequest, GenerateResponse, GenerationSettings } from '../domain/types';

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const cancelledJobs = new Set<string>();

function post(message: GenerateResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}

function drawSampledImage(bitmap: ImageBitmap, settings: GenerationSettings): ImageData {
  const width = settings.grid.columns * GENERATION_SAMPLE_SCALE;
  const height = settings.grid.rows * GENERATION_SAMPLE_SCALE;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建离屏画布。');
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

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
