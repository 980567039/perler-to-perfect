import { assertCellBuffer } from '../domain/grid';
import { EMPTY_CELL, type GridSize, type PaletteManifest } from '../domain/types';

const PREVIEW_LONGEST_SIDE = 1040;

export interface AutoPatternPreviewDimensions {
  cellPixels: number;
  width: number;
  height: number;
}

export function autoPatternPreviewDimensions(grid: GridSize): AutoPatternPreviewDimensions {
  const longestGridSide = Math.max(grid.columns, grid.rows);
  const cellPixels = Math.max(1, Math.floor(PREVIEW_LONGEST_SIDE / longestGridSide));
  return {
    cellPixels,
    width: grid.columns * cellPixels,
    height: grid.rows * cellPixels,
  };
}

export async function renderAutoPatternPreview(input: {
  grid: GridSize;
  cells: Uint16Array;
  palette: PaletteManifest;
}): Promise<Blob> {
  assertCellBuffer(input.cells, input.grid, input.palette.colors.length);
  const { cellPixels, width, height } = autoPatternPreviewDimensions(input.grid);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建自动效果图画布。');

  context.imageSmoothingEnabled = false;
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, width, height);
  for (let row = 0; row < input.grid.rows; row += 1) {
    for (let column = 0; column < input.grid.columns; column += 1) {
      const value = input.cells[row * input.grid.columns + column];
      if (value === undefined || value === EMPTY_CELL) continue;
      const color = input.palette.colors[value];
      if (!color) continue;
      context.fillStyle = color.srgbHex;
      context.fillRect(column * cellPixels, row * cellPixels, cellPixels, cellPixels);
    }
  }

  const preview = await canvas.convertToBlob({ type: 'image/png' });
  if (preview.type !== 'image/png' || preview.size === 0) {
    throw new Error('自动效果图 PNG 渲染失败。');
  }
  return preview;
}
