import { describe, expect, it } from 'vitest';
import { hexToRgb } from './color';
import { generatePattern } from './generation';
import type { GenerationSettings, PaletteManifest } from './types';

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

const adaptivePalette: PaletteManifest = {
  schemaVersion: 1,
  id: 'test:adaptive',
  brand: 'Test',
  edition: 'Adaptive colors',
  version: '1',
  source: { label: 'test fixture' },
  colors: [
    { id: 'test:gray', code: 'G1', srgbHex: '#808080' },
    { id: 'test:near-gray', code: 'G2', srgbHex: '#909090' },
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

function gridSample(columns: number, rows: number, colors: string[]): ImageData {
  if (colors.length !== columns * rows) throw new Error('test grid color count mismatch');
  const width = columns * 4;
  const height = rows * 4;
  const data = new Uint8ClampedArray(width * height * 4);
  colors.forEach((hex, cellIndex) => {
    const rgb = hexToRgb(hex);
    const cellRow = Math.floor(cellIndex / columns);
    const cellColumn = cellIndex % columns;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const offset = ((cellRow * 4 + y) * width + cellColumn * 4 + x) * 4;
        data[offset] = rgb.r;
        data[offset + 1] = rgb.g;
        data[offset + 2] = rgb.b;
        data[offset + 3] = 255;
      }
    }
  });
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

function adaptiveSettings(
  columns: number,
  rows: number,
  patch: Partial<GenerationSettings> = {},
): GenerationSettings {
  return {
    grid: { columns, rows },
    fit: 'contain',
    transform: { scale: 1, offsetX: 0, offsetY: 0 },
    maxUsedColors: 3,
    minimumPaletteDistance: 0,
    enabledColorIds: adaptivePalette.colors.map((color) => color.id),
    lockedColorIds: [],
    cleanupRegionSize: 0,
    detailPriority: true,
    ...patch,
  };
}

describe('pattern generation', () => {
  it('maps one target cell to exactly one palette index', () => {
    const result = generatePattern(solidSample(8, 8, 8), twoColorPalette, {
      grid: { columns: 1, rows: 1 },
      fit: 'contain',
      transform: { scale: 1, offsetX: 0, offsetY: 0 },
      maxUsedColors: 2,
      minimumPaletteDistance: 0,
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
      minimumPaletteDistance: 0,
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
        minimumPaletteDistance: 0,
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
      minimumPaletteDistance: 0,
      enabledColorIds: ['test:white', 'test:black'],
      lockedColorIds: [],
      cleanupRegionSize: 0 as const,
    };

    expect(generatePattern(sampledImage, twoColorPalette, { ...baseSettings, detailPriority: false }).cells[0]).toBe(0);
    expect(generatePattern(sampledImage, twoColorPalette, { ...baseSettings, detailPriority: true }).cells[0]).toBe(1);
  });

  it('treats the color limit as a ceiling and suppresses a low-support nearby shade', () => {
    const colors = Array<string>(100).fill('#808080');
    colors.fill('#909090', 95);

    const result = generatePattern(
      gridSample(20, 5, colors),
      adaptivePalette,
      adaptiveSettings(20, 5, { minimumPaletteDistance: 8, detailPriority: false }),
    );

    expect(result.counts).toEqual([
      expect.objectContaining({ colorId: 'test:gray', count: 100 }),
    ]);
    expect(result.selectedPaletteIndices).toEqual([0]);
  });

  it('keeps a nearby shade when it covers a substantial region', () => {
    const colors = Array<string>(100).fill('#808080');
    colors.fill('#909090', 50);

    const result = generatePattern(
      gridSample(20, 5, colors),
      adaptivePalette,
      adaptiveSettings(20, 5, { minimumPaletteDistance: 8, detailPriority: false }),
    );

    expect(result.counts.map(({ paletteIndex, count }) => [paletteIndex, count])).toEqual([
      [0, 50],
      [1, 50],
    ]);
  });

  it('cleans a low-contrast island even when detail priority is enabled', () => {
    const colors = Array<string>(9).fill('#808080');
    colors[4] = '#909090';

    const result = generatePattern(
      gridSample(3, 3, colors),
      adaptivePalette,
      adaptiveSettings(3, 3, { cleanupRegionSize: 1, detailPriority: true }),
    );

    expect([...result.cells]).toEqual(Array<number>(9).fill(0));
    expect(result.counts).toEqual([
      expect.objectContaining({ colorId: 'test:gray', count: 9 }),
    ]);
  });

  it('preserves a high-contrast structural detail during small-region cleanup', () => {
    const colors = Array<string>(9).fill('#808080');
    colors[4] = '#000000';

    const result = generatePattern(
      gridSample(3, 3, colors),
      adaptivePalette,
      adaptiveSettings(3, 3, { cleanupRegionSize: 1, detailPriority: true }),
    );

    expect(result.cells[4]).toBe(2);
    expect(result.counts).toEqual(expect.arrayContaining([
      expect.objectContaining({ colorId: 'test:gray', count: 8 }),
      expect.objectContaining({ colorId: 'test:black', count: 1 }),
    ]));
  });

  it('regularizes a low-contrast isolated bead without using global cleanup', () => {
    const colors = Array<string>(9).fill('#808080');
    colors[4] = '#909090';
    const result = generatePattern(
      gridSample(3, 3, colors),
      adaptivePalette,
      adaptiveSettings(3, 3, {
        cleanupRegionSize: 0,
        structureStrength: 0.8,
        renderProfile: 'shape',
      }),
    );
    expect([...result.cells]).toEqual(Array<number>(9).fill(0));
    expect(result.diagnostics?.noiseScore).toBeGreaterThan(0);
    expect(result.diagnostics?.reasons[4]).toBe('noise');
  });

  it('returns three deterministic profiles from one sampled image', async () => {
    const { generatePatternCandidates } = await import('./generation');
    const candidates = generatePatternCandidates(
      gridSample(3, 3, Array<string>(9).fill('#808080')),
      adaptivePalette,
      adaptiveSettings(3, 3, { maxUsedColors: 3 }),
    );
    expect(candidates.map((candidate) => candidate.profile)).toEqual(['shape', 'balanced', 'detail']);
    expect(candidates.every((candidate) => candidate.result.cells.length === 9)).toBe(true);
  });
});
