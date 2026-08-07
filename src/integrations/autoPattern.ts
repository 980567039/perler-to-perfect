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

export function createAutoGenerationSettings(settings: AutoGenerationSettings): GenerationSettings {
  return {
    ...createDefaultSettings(MARD_STANDARD_221_PALETTE),
    grid: { columns: settings.columns, rows: settings.rows },
    fit: 'crop',
    transform: { scale: 1, offsetX: 0, offsetY: 0 },
    cropBox: undefined,
    maxUsedColors: settings.maxUsedColors,
    detailPriority: true,
    cleanupRegionSize: 0,
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
  const background = detectBorderBackground(cells, result.grid);
  for (const index of background) cells[index] = EMPTY_CELL;
  const { counts, totalBeads } = countCells(cells, result.grid, MARD_STANDARD_221_PALETTE);
  return {
    ...result,
    cells,
    counts,
    totalBeads,
    selectedPaletteIndices: counts.map((entry) => entry.paletteIndex),
  };
}
