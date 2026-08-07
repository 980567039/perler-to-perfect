import { afterEach, describe, expect, it, vi } from 'vitest';
import { MARD_STANDARD_221_PALETTE } from '../domain/mardPalette';
import { EMPTY_CELL, type PatternResult } from '../domain/types';
import {
  createAutoGenerationSettings,
  decodeAutoSource,
  refineAutoPattern,
  removeAutoBorderBackground,
} from './autoPattern';

function paletteIndex(code: string): number {
  const index = MARD_STANDARD_221_PALETTE.colors.findIndex((color) => color.code === code);
  if (index < 0) throw new Error(`Missing test color ${code}`);
  return index;
}

function pattern(columns: number, rows: number, cells: Uint16Array): PatternResult {
  return {
    grid: { columns, rows },
    cells,
    counts: [],
    totalBeads: cells.length,
    selectedPaletteIndices: [],
  };
}

describe('automatic pattern pipeline helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates isolated MARD settings from the requested specification', () => {
    const settings = createAutoGenerationSettings({
      columns: 80,
      rows: 120,
      maxUsedColors: 32,
      removeBorderBackground: true,
    });

    expect(settings).toEqual(expect.objectContaining({
      grid: { columns: 80, rows: 120 },
      fit: 'crop',
      transform: { scale: 1, offsetX: 0, offsetY: 0 },
      maxUsedColors: 32,
      minimumPaletteDistance: 4,
      cleanupRegionSize: 2,
      detailPriority: true,
    }));
    expect(settings.enabledColorIds).toHaveLength(221);
  });

  it('removes the dominant border-connected color once and recalculates counts', () => {
    const result: PatternResult = {
      grid: { columns: 4, rows: 4 },
      cells: new Uint16Array([
        0, 0, 0, 0,
        0, 1, 1, 0,
        0, 1, 0, 0,
        0, 0, 0, 0,
      ]),
      counts: [],
      totalBeads: 16,
      selectedPaletteIndices: [0, 1],
    };

    const cleaned = removeAutoBorderBackground(result);

    expect(cleaned.cells[5]).toBe(1);
    expect(cleaned.cells[10]).toBe(EMPTY_CELL);
    expect(cleaned.totalBeads).toBe(3);
    expect(cleaned.counts.map(({ paletteIndex, count }) => [paletteIndex, count])).toEqual([[1, 3]]);
    expect(result.cells[0]).toBe(0);
  });

  it('removes a similar-color border-connected background gradient at 104 × 104', () => {
    const pale = paletteIndex('H1');
    const nearbyPale = paletteIndex('H2');
    const black = paletteIndex('H7');
    const cells = new Uint16Array(104 * 104);
    cells.fill(nearbyPale);
    for (let column = 0; column < 104; column += 1) {
      cells[column] = pale;
      cells[103 * 104 + column] = pale;
    }
    for (let row = 0; row < 104; row += 1) {
      cells[row * 104] = pale;
      cells[row * 104 + 103] = pale;
    }
    cells[52 * 104 + 52] = black;

    const cleaned = removeAutoBorderBackground(pattern(104, 104, cells));

    expect(cleaned.cells[0]).toBe(EMPTY_CELL);
    expect(cleaned.cells[51 * 104 + 51]).toBe(EMPTY_CELL);
    expect(cleaned.cells[52 * 104 + 52]).toBe(black);
    expect(cleaned.totalBeads).toBe(1);
    expect(cleaned.counts).toEqual([
      expect.objectContaining({ paletteIndex: black, count: 1 }),
    ]);
  });

  it('merges only an isolated low-contrast cell in the 104 fine pass', () => {
    const lightGray = paletteIndex('H9');
    const nearbyGray = paletteIndex('H10');
    const cells = new Uint16Array(104 * 104);
    cells.fill(EMPTY_CELL);
    for (let row = 50; row <= 52; row += 1) {
      for (let column = 50; column <= 52; column += 1) {
        cells[row * 104 + column] = lightGray;
      }
    }
    cells[51 * 104 + 51] = nearbyGray;

    const refined = refineAutoPattern(pattern(104, 104, cells), 40);

    expect(refined.cells[51 * 104 + 51]).toBe(lightGray);
    expect(refined.counts).toEqual([
      expect.objectContaining({ paletteIndex: lightGray, count: 9 }),
    ]);
    expect(refined.grid).toEqual({ columns: 104, rows: 104 });
  });

  it('preserves an isolated high-contrast detail such as a black eye', () => {
    const lightGray = paletteIndex('H9');
    const black = paletteIndex('H7');
    const cells = new Uint16Array(104 * 104);
    cells.fill(EMPTY_CELL);
    for (let row = 50; row <= 52; row += 1) {
      for (let column = 50; column <= 52; column += 1) {
        cells[row * 104 + column] = lightGray;
      }
    }
    cells[51 * 104 + 51] = black;

    const refined = refineAutoPattern(pattern(104, 104, cells), 40);

    expect(refined.cells[51 * 104 + 51]).toBe(black);
    expect(refined.counts).toEqual(expect.arrayContaining([
      expect.objectContaining({ paletteIndex: lightGray, count: 8 }),
      expect.objectContaining({ paletteIndex: black, count: 1 }),
    ]));
  });

  it('does not apply isolated-cell refinement to non-104 grids', () => {
    const lightGray = paletteIndex('H9');
    const nearbyGray = paletteIndex('H10');
    const cells = new Uint16Array(3 * 3);
    cells.fill(lightGray);
    cells[4] = nearbyGray;

    const refined = refineAutoPattern(pattern(3, 3, cells), 40);

    expect(refined.cells[4]).toBe(nearbyGray);
    expect(refined.cells).not.toBe(cells);
  });

  it('rejects decoded source images above the pixel limit', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10_000, height: 5_000, close }));

    await expect(decodeAutoSource(new Blob(['image'], { type: 'image/png' }))).rejects.toThrow('4000 万像素');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
