import { gridCanvasDimensions, visualCanvasDimensions } from '../rendering/patternDrawing';

/**
 * Keep the largest export canvases comfortably below the browser's memory
 * pressure point. The limit applies to the decoded RGBA backing store, not
 * the usually much smaller compressed PNG.
 */
export const MAX_GRID_CANVAS_PIXELS = 32_000_000;
export const MAX_VISUAL_CANVAS_PIXELS = 24_000_000;

export const MAX_EXPORT_CELL_PIXELS = 24;
export const MIN_GRID_CELL_PIXELS = 16;
export const MIN_VISUAL_CELL_PIXELS = 8;

interface CanvasDimensions {
  width: number;
  height: number;
}

function chooseCellPixels(
  columns: number,
  rows: number,
  maxPixels: number,
  maxCellPixels: number,
  minCellPixels: number,
  getDimensions: (columns: number, rows: number, cellPixels: number) => CanvasDimensions,
): number {
  for (let cellPixels = maxCellPixels; cellPixels >= minCellPixels; cellPixels -= 1) {
    const dimensions = getDimensions(columns, rows, cellPixels);
    if (dimensions.width * dimensions.height <= maxPixels) return cellPixels;
  }
  throw new Error('导出画布像素面积超过安全上限，请减小网格尺寸。');
}

export function chooseGridCellPixels(columns: number, rows: number): number {
  return chooseCellPixels(
    columns,
    rows,
    MAX_GRID_CANVAS_PIXELS,
    MAX_EXPORT_CELL_PIXELS,
    MIN_GRID_CELL_PIXELS,
    gridCanvasDimensions,
  );
}

export function chooseVisualCellPixels(columns: number, rows: number): number {
  return chooseCellPixels(
    columns,
    rows,
    MAX_VISUAL_CANVAS_PIXELS,
    MAX_EXPORT_CELL_PIXELS,
    MIN_VISUAL_CELL_PIXELS,
    visualCanvasDimensions,
  );
}
