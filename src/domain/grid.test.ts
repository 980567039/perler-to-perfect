import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_PALETTE } from './devPalette';
import { countCells, decodeCellsRle, detectBorderBackground, encodeCellsRle, validateGridSize } from './grid';
import { EMPTY_CELL } from './types';

describe('grid model', () => {
  it('accepts 300×300 and rejects either side above the production limit', () => {
    expect(() => validateGridSize({ columns: 300, rows: 300 })).not.toThrow();
    expect(() => validateGridSize({ columns: 301, rows: 300 })).toThrow('1–300');
    expect(() => validateGridSize({ columns: 300, rows: 301 })).toThrow('1–300');
  });

  it('round-trips RLE without losing EMPTY cells', () => {
    const cells = new Uint16Array([0, 0, EMPTY_CELL, EMPTY_CELL, 3, 3, 3, 0]);
    const runs = encodeCellsRle(cells);
    expect(decodeCellsRle(runs, cells.length)).toEqual(cells);
  });

  it('counts only non-empty cells', () => {
    const cells = new Uint16Array([0, EMPTY_CELL, 1, 1]);
    const result = countCells(cells, { columns: 2, rows: 2 }, DEVELOPMENT_PALETTE);
    expect(result.totalBeads).toBe(3);
    expect(result.counts.map(({ paletteIndex, count }) => [paletteIndex, count])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it('detects only the border-connected dominant background', () => {
    const cells = new Uint16Array([
      0, 0, 0, 0,
      0, 1, 1, 0,
      0, 1, 0, 0,
      0, 0, 0, 0,
    ]);
    const detected = new Set(detectBorderBackground(cells, { columns: 4, rows: 4 }));
    expect(detected.has(5)).toBe(false);
    expect(detected.has(10)).toBe(true);
    expect(detected.size).toBe(13);
  });
});
