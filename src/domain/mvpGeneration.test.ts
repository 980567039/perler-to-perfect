import { describe, expect, it } from 'vitest';
import { generateMvpPattern } from './mvpGeneration';
import type { GenerationSettings, PaletteManifest } from './types';

const palette: PaletteManifest = {
  schemaVersion: 1,
  id: 'test:mvp',
  brand: 'Test',
  edition: 'mvp fixture',
  version: '1',
  source: { label: 'test fixture' },
  colors: [
    { id: 'test:cream', code: 'C1', srgbHex: '#FAF2DC' },
    { id: 'test:red', code: 'R1', srgbHex: '#DC2850' },
    { id: 'test:black', code: 'K1', srgbHex: '#111216' },
  ],
};

function settings(columns: number, rows: number): GenerationSettings {
  return {
    grid: { columns, rows },
    fit: 'crop',
    transform: { scale: 1, offsetX: 0, offsetY: 0 },
    maxUsedColors: 2,
    minimumPaletteDistance: 12,
    enabledColorIds: palette.colors.map((color) => color.id),
    lockedColorIds: [],
    cleanupRegionSize: 4,
    detailPriority: false,
    renderProfile: 'shape',
    structureStrength: 1,
  };
}

function framedSource(): ImageData {
  const width = 160;
  const height = 160;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 16; row < 144; row += 1) {
    for (let column = 16; column < 144; column += 1) {
      const offset = (row * width + column) * 4;
      data[offset] = 250;
      data[offset + 1] = 242;
      data[offset + 2] = 220;
      data[offset + 3] = 255;
    }
  }
  for (let row = 40; row < 120; row += 1) {
    for (let column = 64; column < 96; column += 1) {
      const offset = (row * width + column) * 4;
      data[offset] = 220;
      data[offset + 1] = 40;
      data[offset + 2] = 80;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

describe('mvp generation', () => {
  it('keeps the mvp foreground, aspect-fit and nearest-color behavior', () => {
    const result = generateMvpPattern(framedSource(), palette, settings(20, 20));

    expect(result.grid).toEqual({ columns: 20, rows: 20 });
    expect(result.cells[0]).toBe(0xffff);
    expect(result.totalBeads).toBeGreaterThan(0);
    expect(result.totalBeads).toBeLessThan(20 * 20);
    expect(result.counts).toEqual([
      expect.objectContaining({ colorId: 'test:red' }),
    ]);
  });

  it('does not apply the previous close-color, color-limit or cleanup passes', () => {
    const result = generateMvpPattern(framedSource(), palette, settings(20, 20));

    expect(result.diagnostics).toBeUndefined();
    expect(result.selectedPaletteIndices).toEqual(result.counts.map((entry) => entry.paletteIndex));
  });
});

