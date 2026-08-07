import { deltaE2000, hexToLab } from '../domain/color';
import { countCells, detectBorderBackground } from '../domain/grid';
import { MARD_STANDARD_221_PALETTE } from '../domain/mardPalette';
import {
  EMPTY_CELL,
  MAX_SOURCE_PIXELS,
  createDefaultSettings,
  type GenerationSettings,
  type PatternResult,
} from '../domain/types';
import type { AutoGenerationSettings } from './redinkAutoBridge';

const AUTO_FINE_GRID_SIDE = 104;
const BACKGROUND_DELTA_E_LIMIT = 8;
const ISOLATED_CELL_DELTA_E_LIMIT = 6;
const paletteLabs = MARD_STANDARD_221_PALETTE.colors.map(
  (color) => color.labD65 ?? hexToLab(color.srgbHex),
);

export function createAutoGenerationSettings(settings: AutoGenerationSettings): GenerationSettings {
  return {
    ...createDefaultSettings(MARD_STANDARD_221_PALETTE),
    grid: { columns: settings.columns, rows: settings.rows },
    fit: 'crop',
    transform: { scale: 1, offsetX: 0, offsetY: 0 },
    cropBox: undefined,
    maxUsedColors: settings.maxUsedColors,
    minimumPaletteDistance: 4,
    detailPriority: true,
    cleanupRegionSize: 2,
  };
}

export async function decodeAutoSource(image: Blob): Promise<ImageBitmap> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('源图片无法解码。');
  }
  if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width * bitmap.height > MAX_SOURCE_PIXELS) {
    bitmap.close();
    throw new Error('图片解码后超过 4000 万像素，请先缩小。');
  }
  return bitmap;
}

export function removeAutoBorderBackground(result: PatternResult): PatternResult {
  const cells = result.cells.slice();
  const background = isFineGrid(result)
    ? detectSimilarBorderBackground(cells, result.grid.columns, result.grid.rows)
    : detectBorderBackground(cells, result.grid);
  for (const index of background) cells[index] = EMPTY_CELL;
  return recountResult(result, cells);
}

/**
 * Applies a deliberately conservative cleanup pass used only by RedInk's
 * automatic 104 × 104 pipeline. Other grid sizes are copied and recounted,
 * preserving the behavior of the existing automatic background pass.
 */
export function refineAutoPattern(result: PatternResult, maxUsedColors: number): PatternResult {
  if (!Number.isInteger(maxUsedColors) || maxUsedColors < 2 || maxUsedColors > 64) {
    throw new Error('自动精细化的最大用色数无效。');
  }

  const cells = result.cells.slice();
  if (isFineGrid(result)) mergeLowContrastIsolatedCells(cells, result.grid.columns, result.grid.rows);
  const refined = recountResult(result, cells);
  if (refined.counts.length > maxUsedColors) {
    throw new Error('自动精细化后的实际用色数超过设定上限。');
  }
  return refined;
}

function isFineGrid(result: PatternResult): boolean {
  return result.grid.columns === AUTO_FINE_GRID_SIDE && result.grid.rows === AUTO_FINE_GRID_SIDE;
}

function recountResult(result: PatternResult, cells: Uint16Array): PatternResult {
  const { counts, totalBeads } = countCells(cells, result.grid, MARD_STANDARD_221_PALETTE);
  return {
    ...result,
    cells,
    counts,
    totalBeads,
    selectedPaletteIndices: counts.map((entry) => entry.paletteIndex),
  };
}

function dominantBorderColor(cells: Uint16Array, columns: number, rows: number): number {
  const counts = new Map<number, number>();
  const count = (row: number, column: number) => {
    const value = cells[row * columns + column];
    if (value === undefined || value === EMPTY_CELL) return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  };

  for (let column = 0; column < columns; column += 1) {
    count(0, column);
    if (rows > 1) count(rows - 1, column);
  }
  for (let row = 1; row < rows - 1; row += 1) {
    count(row, 0);
    if (columns > 1) count(row, columns - 1);
  }

  let target = EMPTY_CELL;
  let targetCount = -1;
  for (const [value, valueCount] of counts) {
    if (valueCount > targetCount || (valueCount === targetCount && value < target)) {
      target = value;
      targetCount = valueCount;
    }
  }
  return target;
}

function colorDistance(first: number, second: number): number {
  const firstLab = paletteLabs[first];
  const secondLab = paletteLabs[second];
  if (!firstLab || !secondLab) return Number.POSITIVE_INFINITY;
  return deltaE2000(firstLab, secondLab);
}

function detectSimilarBorderBackground(cells: Uint16Array, columns: number, rows: number): number[] {
  const target = dominantBorderColor(cells, columns, rows);
  if (target === EMPTY_CELL) return [];

  const isBackgroundColor = (value: number | undefined) => (
    value !== undefined &&
    value !== EMPTY_CELL &&
    colorDistance(target, value) <= BACKGROUND_DELTA_E_LIMIT
  );
  const visited = new Uint8Array(cells.length);
  const stack: number[] = [];
  const push = (row: number, column: number) => {
    if (row < 0 || row >= rows || column < 0 || column >= columns) return;
    const index = row * columns + column;
    if (visited[index] === 1 || !isBackgroundColor(cells[index])) return;
    visited[index] = 1;
    stack.push(index);
  };

  for (let column = 0; column < columns; column += 1) {
    push(0, column);
    push(rows - 1, column);
  }
  for (let row = 1; row < rows - 1; row += 1) {
    push(row, 0);
    push(row, columns - 1);
  }

  const background: number[] = [];
  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined) break;
    background.push(index);
    const row = Math.floor(index / columns);
    const column = index % columns;
    push(row - 1, column);
    push(row + 1, column);
    push(row, column - 1);
    push(row, column + 1);
  }
  return background.sort((first, second) => first - second);
}

function mergeLowContrastIsolatedCells(cells: Uint16Array, columns: number, rows: number): void {
  const source = cells.slice();
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const current = source[index];
      if (current === undefined || current === EMPTY_CELL) continue;

      const neighborCounts = new Map<number, number>();
      let nonEmptyNeighbors = 0;
      let sameColorNeighbor = false;
      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
          if (rowOffset === 0 && columnOffset === 0) continue;
          const neighborRow = row + rowOffset;
          const neighborColumn = column + columnOffset;
          if (neighborRow < 0 || neighborRow >= rows || neighborColumn < 0 || neighborColumn >= columns) continue;
          const neighbor = source[neighborRow * columns + neighborColumn];
          if (neighbor === undefined || neighbor === EMPTY_CELL) continue;
          nonEmptyNeighbors += 1;
          if (neighbor === current) sameColorNeighbor = true;
          neighborCounts.set(neighbor, (neighborCounts.get(neighbor) ?? 0) + 1);
        }
      }
      if (sameColorNeighbor || nonEmptyNeighbors < 4) continue;

      let replacement = EMPTY_CELL;
      let replacementCount = 0;
      for (const [value, valueCount] of neighborCounts) {
        if (valueCount > replacementCount || (valueCount === replacementCount && value < replacement)) {
          replacement = value;
          replacementCount = valueCount;
        }
      }
      if (
        replacement !== EMPTY_CELL &&
        replacementCount >= 4 &&
        replacementCount * 2 > nonEmptyNeighbors &&
        colorDistance(current, replacement) <= ISOLATED_CELL_DELTA_E_LIMIT
      ) cells[index] = replacement;
    }
  }
}
