import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_CELL, type PatternResult } from '../domain/types';
import { createAutoGenerationSettings, decodeAutoSource, removeAutoBorderBackground } from './autoPattern';

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
      cleanupRegionSize: 0,
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

  it('rejects decoded source images above the pixel limit', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10_000, height: 5_000, close }));

    await expect(decodeAutoSource(new Blob(['image'], { type: 'image/png' }))).rejects.toThrow('4000 万像素');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
