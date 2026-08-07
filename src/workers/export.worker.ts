/// <reference lib="webworker" />

import { zipSync } from 'fflate';
import { drawPatternGrid, gridCanvasDimensions } from '../rendering/patternDrawing';
import type { ExportRequest, ExportResponse, PatternExportRequest } from './export.types';

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const MAX_MASTER_PIXELS = 64_000_000;

function post(message: ExportResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}

async function canvasToBytes(canvas: OffscreenCanvas): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

function chooseMasterCellPixels(columns: number, rows: number): number {
  for (let cellPixels = 24; cellPixels >= 16; cellPixels -= 1) {
    const dimensions = gridCanvasDimensions(columns, rows, cellPixels);
    if (dimensions.width * dimensions.height <= MAX_MASTER_PIXELS) return cellPixels;
  }
  throw new Error('母版像素面积超过安全上限，请减小网格尺寸。');
}

async function renderGrid(
  cells: Uint16Array,
  request: Pick<PatternExportRequest, 'grid' | 'palette' | 'watermarkEnabled'>,
  startRow: number,
  startColumn: number,
  rows: number,
  columns: number,
  cellPixels: number,
): Promise<Uint8Array> {
  const dimensions = gridCanvasDimensions(columns, rows, cellPixels);
  const canvas = new OffscreenCanvas(dimensions.width, dimensions.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建导出画布。');
  drawPatternGrid(context, {
    cells,
    fullGrid: request.grid,
    palette: request.palette,
    startRow,
    startColumn,
    rows,
    columns,
    cellPixels,
    watermarkEnabled: request.watermarkEnabled,
  });
  return canvasToBytes(canvas);
}

async function renderLegend(request: ExportRequest): Promise<Uint8Array> {
  const rowHeight = 42;
  const width = 1000;
  const height = 120 + Math.max(1, request.counts.length) * rowHeight;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建图例画布。');
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#111827';
  context.font = '700 28px system-ui, sans-serif';
  context.fillText(request.projectName, 32, 42);
  context.font = '500 16px system-ui, sans-serif';
  context.fillStyle = '#4B5563';
  context.fillText(
    `${request.grid.columns} × ${request.grid.rows} 格 · ${request.counts.length} 色 · ${request.totalBeads} 颗`,
    32,
    76,
  );
  context.fillText(`${request.palette.brand} / ${request.palette.edition} / ${request.palette.version}`, 32, 101);

  request.counts.forEach((entry, index) => {
    const color = request.palette.colors[entry.paletteIndex];
    if (!color) return;
    const y = 120 + index * rowHeight;
    context.fillStyle = index % 2 === 0 ? '#F9FAFB' : '#FFFFFF';
    context.fillRect(20, y, width - 40, rowHeight);
    context.fillStyle = color.srgbHex;
    context.fillRect(34, y + 9, 24, 24);
    context.strokeStyle = '#9CA3AF';
    context.strokeRect(34.5, y + 9.5, 23, 23);
    context.fillStyle = '#111827';
    context.font = '700 16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    context.fillText(color.code, 76, y + 27);
    context.font = '500 15px system-ui, sans-serif';
    context.fillStyle = '#4B5563';
    context.fillText(color.name ?? color.id, 180, y + 27);
    context.textAlign = 'right';
    context.fillStyle = '#111827';
    context.fillText(`${entry.count} 颗`, width - 40, y + 27);
    context.textAlign = 'left';
  });
  return canvasToBytes(canvas);
}

workerScope.onmessage = async (event: MessageEvent<PatternExportRequest>) => {
  const request = event.data;
  if (request.type !== 'EXPORT' && request.type !== 'EXPORT_MASTER') return;
  try {
    const cells = new Uint16Array(request.cells);
    const tileRows = request.type === 'EXPORT' ? Math.ceil(request.grid.rows / request.tileSize) : 0;
    const tileColumns = request.type === 'EXPORT' ? Math.ceil(request.grid.columns / request.tileSize) : 0;
    const totalSteps = request.type === 'EXPORT' ? tileRows * tileColumns + 2 : 1;
    post({ type: 'PROGRESS', jobId: request.jobId, completed: 0, total: totalSteps, stage: '母版' });
    const masterCellPixels = chooseMasterCellPixels(request.grid.columns, request.grid.rows);
    const master = await renderGrid(
      cells,
      request,
      0,
      0,
      request.grid.rows,
      request.grid.columns,
      masterCellPixels,
    );

    if (request.type === 'EXPORT_MASTER') {
      const masterBuffer = master.buffer.slice(master.byteOffset, master.byteOffset + master.byteLength) as ArrayBuffer;
      post({ type: 'PROGRESS', jobId: request.jobId, completed: 1, total: 1, stage: '母版' });
      post({ type: 'MASTER_RESULT', jobId: request.jobId, master: masterBuffer }, [masterBuffer]);
      return;
    }

    let completed = 0;
    completed += 1;
    post({ type: 'PROGRESS', jobId: request.jobId, completed, total: totalSteps, stage: '图例' });
    const legend = await renderLegend(request);
    completed += 1;

    const files: Record<string, Uint8Array> = {
      [`${request.projectName}-master.png`]: master,
      [`${request.projectName}-legend.png`]: legend,
    };
    for (let tileRow = 0; tileRow < tileRows; tileRow += 1) {
      for (let tileColumn = 0; tileColumn < tileColumns; tileColumn += 1) {
        const startRow = tileRow * request.tileSize;
        const startColumn = tileColumn * request.tileSize;
        const rows = Math.min(request.tileSize, request.grid.rows - startRow);
        const columns = Math.min(request.tileSize, request.grid.columns - startColumn);
        const tile = await renderGrid(cells, request, startRow, startColumn, rows, columns, 32);
        const rowEnd = startRow + rows;
        const columnEnd = startColumn + columns;
        const fileName = `tiles/r${String(startRow + 1).padStart(3, '0')}-${String(rowEnd).padStart(3, '0')}_c${String(startColumn + 1).padStart(3, '0')}-${String(columnEnd).padStart(3, '0')}.png`;
        files[fileName] = tile;
        completed += 1;
        post({ type: 'PROGRESS', jobId: request.jobId, completed, total: totalSteps, stage: '分块' });
      }
    }

    const archive = zipSync(files, { level: 0 });
    const masterBuffer = master.buffer.slice(master.byteOffset, master.byteOffset + master.byteLength) as ArrayBuffer;
    const archiveBuffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
    post({ type: 'RESULT', jobId: request.jobId, master: masterBuffer, archive: archiveBuffer }, [
      masterBuffer,
      archiveBuffer,
    ]);
  } catch (error) {
    post({
      type: 'ERROR',
      jobId: request.jobId,
      message: error instanceof Error ? error.message : '导出失败。',
    });
  }
};

export {};
