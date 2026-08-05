import type { ColorCount, GridSize, PaletteManifest } from '../domain/types';
import type { ExportResponse } from './export.types';

interface ExportInput {
  projectName: string;
  grid: GridSize;
  cells: Uint16Array;
  palette: PaletteManifest;
  counts: ColorCount[];
  totalBeads: number;
  tileSize: number;
}

export interface ExportResult {
  master: Blob;
  archive: Blob;
}

export function exportPattern(
  input: ExportInput,
  onProgress: (message: Extract<ExportResponse, { type: 'PROGRESS' }>) => void,
): Promise<ExportResult> {
  const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
  const jobId = crypto.randomUUID();
  const cells = input.cells.slice();
  const cellsBuffer = cells.buffer as ArrayBuffer;
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<ExportResponse>) => {
      const message = event.data;
      if (message.jobId !== jobId) return;
      if (message.type === 'PROGRESS') {
        onProgress(message);
        return;
      }
      worker.terminate();
      if (message.type === 'ERROR') {
        reject(new Error(message.message));
        return;
      }
      resolve({
        master: new Blob([message.master], { type: 'image/png' }),
        archive: new Blob([message.archive], { type: 'application/zip' }),
      });
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || '导出 Worker 发生错误。'));
    };
    worker.postMessage(
      {
        type: 'EXPORT',
        jobId,
        projectName: input.projectName,
        grid: input.grid,
        cells: cellsBuffer,
        palette: input.palette,
        counts: input.counts,
        totalBeads: input.totalBeads,
        tileSize: input.tileSize,
      },
      [cellsBuffer],
    );
  });
}
