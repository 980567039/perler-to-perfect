import type {
  GenerateResponse,
  GenerationSettings,
  PaletteManifest,
  PatternResult,
  SubjectHints,
} from '../domain/types';

export interface GenerationTask {
  promise: Promise<PatternResult>;
  cancel: () => void;
}

export function startGeneration(
  bitmap: ImageBitmap,
  palette: PaletteManifest,
  settings: GenerationSettings,
  onProgress: (message: Extract<GenerateResponse, { type: 'PROGRESS' }>) => void,
  subjectHints?: SubjectHints,
): GenerationTask {
  const worker = new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' });
  const jobId = crypto.randomUUID();
  let settled = false;
  let rejectTask: ((reason?: unknown) => void) | null = null;

  const promise = new Promise<PatternResult>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = (event: MessageEvent<GenerateResponse>) => {
      const message = event.data;
      if (message.jobId !== jobId) return;
      if (message.type === 'PROGRESS') {
        onProgress(message);
        return;
      }
      settled = true;
      worker.terminate();
      rejectTask = null;
      if (message.type === 'ERROR') {
        reject(new Error(message.message));
        return;
      }
      resolve({
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
      });
    };
    worker.onerror = (event) => {
      settled = true;
      worker.terminate();
      rejectTask = null;
      reject(new Error(event.message || '生成 Worker 发生错误。'));
    };
    worker.postMessage({ type: 'GENERATE', jobId, bitmap, palette, settings, subjectHints }, [bitmap]);
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectTask?.(new Error('任务已取消。'));
      rejectTask = null;
    },
  };
}
