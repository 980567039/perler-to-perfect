import type {
  GenerateResponse,
  GenerationSettings,
  PaletteManifest,
  PatternResult,
} from '../domain/types';

export interface GenerationTask {
  promise: Promise<PatternResult>;
  cancel: () => void;
}

export interface GenerationOptions {
  /** Kept for RedInk callers compiled against the previous API; mvp runs locally. */
  sourceBlob?: Blob;
}

export function startGeneration(
  bitmap: ImageBitmap,
  palette: PaletteManifest,
  settings: GenerationSettings,
  onProgress: (message: Extract<GenerateResponse, { type: 'PROGRESS' }>) => void,
  _subjectHints?: never,
  _options: GenerationOptions = {},
): GenerationTask {
  const workerJobId = crypto.randomUUID();
  let settled = false;
  let worker: Worker | null = null;
  let rejectTask: ((reason?: unknown) => void) | null = null;
  let resolveTask: ((result: PatternResult) => void) | null = null;
  let bitmapAvailable = true;

  const closeBitmap = () => {
    if (!bitmapAvailable) return;
    bitmapAvailable = false;
    bitmap.close();
  };

  const promise = new Promise<PatternResult>((resolve, reject) => {
    resolveTask = resolve;
    rejectTask = reject;
  });

  const startWorker = (sampledImage?: ImageData) => {
    if (settled) return;
    worker = new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<GenerateResponse>) => {
      const message = event.data;
      if (message.jobId !== workerJobId) return;
      if (message.type === 'PROGRESS') {
        onProgress(message);
        return;
      }
      settled = true;
      worker?.terminate();
      worker = null;
      if (message.type === 'ERROR') {
        const reject = rejectTask;
        rejectTask = null;
        resolveTask = null;
        // The Worker owns bitmap/sample buffers after postMessage; only the
        // original bitmap that was not transferred is closed by this client.
        reject?.(new Error(message.message));
        return;
      }
      const result: PatternResult = {
        grid: message.grid,
        cells: new Uint16Array(message.cells),
        counts: message.counts,
        totalBeads: message.totalBeads,
        selectedPaletteIndices: message.selectedPaletteIndices,
        diagnostics: message.diagnostics
          ? {
              confidence: new Uint8Array(message.diagnostics.confidence),
              reasons: message.diagnostics.reasons,
              structureScore: message.diagnostics.structureScore,
              noiseScore: message.diagnostics.noiseScore,
            }
          : undefined,
      };
      resolveTask?.(result);
      resolveTask = null;
    };
    worker.onerror = (event) => {
      settled = true;
      worker?.terminate();
      worker = null;
      const reject = rejectTask;
      rejectTask = null;
      resolveTask = null;
      reject?.(new Error(event.message || '生成 Worker 发生错误。'));
    };

    const payload = sampledImage
      ? { type: 'GENERATE' as const, jobId: workerJobId, sampledImage, palette, settings }
      : { type: 'GENERATE' as const, jobId: workerJobId, bitmap, palette, settings };
    const transfer: Transferable[] = sampledImage
      ? [sampledImage.data.buffer as ArrayBuffer]
      : [bitmap];
    worker.postMessage(payload, transfer);
    if (!sampledImage) bitmapAvailable = false;
  };

  onProgress({ type: 'PROGRESS', jobId: workerJobId, stage: 'prepare', completed: 0, total: 1 });
  startWorker();

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker?.terminate();
      worker = null;
      closeBitmap();
      const reject = rejectTask;
      rejectTask = null;
      resolveTask = null;
      reject?.(new Error('任务已取消。'));
    },
  };
}
