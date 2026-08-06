import { describe, expect, it } from 'vitest';
import { generatePattern } from './generation';
import type { PaletteManifest } from './types';

const twoColorPalette: PaletteManifest = {
  schemaVersion: 1,
  id: 'test:two',
  brand: 'Test',
  edition: 'Two colors',
  version: '1',
  source: { label: 'test fixture' },
  colors: [
    { id: 'test:white', code: 'W1', srgbHex: '#FFFFFF' },
    { id: 'test:black', code: 'B1', srgbHex: '#000000' },
  ],
};

function solidSample(red: number, green: number, blue: number, alpha = 255): ImageData {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let index = 0; index < 16; index += 1) {
    data[index * 4] = red;
    data[index * 4 + 1] = green;
    data[index * 4 + 2] = blue;
    data[index * 4 + 3] = alpha;
  }
  return { data, width: 4, height: 4, colorSpace: 'srgb' } as ImageData;
}

describe('pattern generation', () => {
  it('maps one target cell to exactly one palette index', () => {
    const result = generatePattern(solidSample(8, 8, 8), twoColorPalette, {
      grid: { columns: 1, rows: 1 },
      fit: 'contain',
      transform: { scale: 1, offsetX: 0, offsetY: 0 },
      maxUsedColors: 2,
      enabledColorIds: ['test:white', 'test:black'],
      lockedColorIds: [],
      cleanupRegionSize: 0,
      detailPriority: false,
    });
    expect([...result.cells]).toEqual([1]);
    expect(result.totalBeads).toBe(1);
  });

  it('keeps a mostly transparent cell empty', () => {
    const result = generatePattern(solidSample(0, 0, 0, 0), twoColorPalette, {
      grid: { columns: 1, rows: 1 },
      fit: 'contain',
      transform: { scale: 1, offsetX: 0, offsetY: 0 },
      maxUsedColors: 2,
      enabledColorIds: ['test:white', 'test:black'],
      lockedColorIds: [],
      cleanupRegionSize: 0,
      detailPriority: false,
    });
    expect(result.totalBeads).toBe(0);
    expect(result.counts).toEqual([]);
  });

  it('generates the maximum 300×300 grid with a strict palette index per cell', () => {
    const columns = 300;
    const rows = 300;
    const width = columns * 4;
    const height = rows * 4;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 3; index < data.length; index += 4) data[index] = 255;

    const result = generatePattern(
      { data, width, height, colorSpace: 'srgb' } as ImageData,
      twoColorPalette,
      {
        grid: { columns, rows },
        fit: 'contain',
        transform: { scale: 1, offsetX: 0, offsetY: 0 },
        maxUsedColors: 2,
        enabledColorIds: ['test:white', 'test:black'],
        lockedColorIds: [],
        cleanupRegionSize: 0,
        detailPriority: false,
      },
    );

    expect(result.cells).toHaveLength(columns * rows);
    expect(result.totalBeads).toBe(columns * rows);
    expect(result.counts).toHaveLength(1);
    expect(result.selectedPaletteIndices.length).toBeLessThanOrEqual(2);
    expect(result.cells.every((cell) => cell === 1)).toBe(true);
  });

  it('preserves a high-contrast feature that covers one quarter of a cell in detail-priority mode', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let index = 0; index < 16; index += 1) {
      const value = index < 4 ? 0 : 255;
      data[index * 4] = value;
      data[index * 4 + 1] = value;
      data[index * 4 + 2] = value;
      data[index * 4 + 3] = 255;
    }
    const sampledImage = { data, width: 4, height: 4, colorSpace: 'srgb' } as ImageData;
    const baseSettings = {
      grid: { columns: 1, rows: 1 },
      fit: 'contain' as const,
      transform: { scale: 1, offsetX: 0, offsetY: 0 },
      maxUsedColors: 2,
      enabledColorIds: ['test:white', 'test:black'],
      lockedColorIds: [],
      cleanupRegionSize: 0 as const,
    };

    expect(generatePattern(sampledImage, twoColorPalette, { ...baseSettings, detailPriority: false }).cells[0]).toBe(0);
    expect(generatePattern(sampledImage, twoColorPalette, { ...baseSettings, detailPriority: true }).cells[0]).toBe(1);
  });
});
