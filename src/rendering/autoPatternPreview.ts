import { assertCellBuffer } from '../domain/grid';
import { type GridSize, type PaletteManifest, type PatternVisualMode } from '../domain/types';
import { drawPatternVisual } from './patternDrawing';

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

export async function renderAutoPatternVisual(input: {
  grid: GridSize;
  cells: Uint16Array;
  palette: PaletteManifest;
  visualMode: Extract<PatternVisualMode, 'beads' | 'ironed'>;
}): Promise<Blob> {
  assertCellBuffer(input.cells, input.grid, input.palette.colors.length);
  const { cellPixels, width, height } = autoPatternPreviewDimensions(input.grid);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建自动效果图画布。');

  drawPatternVisual(context, {
    cells: input.cells,
    fullGrid: input.grid,
    palette: input.palette,
    startRow: 0,
    startColumn: 0,
    rows: input.grid.rows,
    columns: input.grid.columns,
    cellPixels,
    visualMode: input.visualMode,
    showGridOverlay: false,
    watermarkEnabled: false,
  });

  const preview = await canvas.convertToBlob({ type: 'image/png' });
  if (preview.type !== 'image/png' || preview.size === 0) {
    throw new Error('自动效果图 PNG 渲染失败。');
  }
  return preview;
}

/** Render the un-ironed cylindrical-bead representation used by the UI. */
export async function renderAutoPatternPreview(input: {
  grid: GridSize;
  cells: Uint16Array;
  palette: PaletteManifest;
}): Promise<Blob> {
  return renderAutoPatternVisual({ ...input, visualMode: 'beads' });
}

/** Render the flattened/heat-pressed representation used by the UI. */
export async function renderAutoPatternIronedPreview(input: {
  grid: GridSize;
  cells: Uint16Array;
  palette: PaletteManifest;
}): Promise<Blob> {
  return renderAutoPatternVisual({ ...input, visualMode: 'ironed' });
}
