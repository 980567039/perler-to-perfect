/// <reference types="node" />

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validatePaletteManifest } from './palette';
import { MARD_STANDARD_221_DATA_SHA256, MARD_STANDARD_221_PALETTE } from './mardPalette';

describe('MARD standard 221 palette', () => {
  it('contains the complete contiguous A–H and M standard series', () => {
    const expectedSeriesCounts = { A: 26, B: 32, C: 29, D: 26, E: 24, F: 25, G: 21, H: 23, M: 15 };

    expect(() => validatePaletteManifest(MARD_STANDARD_221_PALETTE)).not.toThrow();
    expect(MARD_STANDARD_221_PALETTE.colors).toHaveLength(221);
    for (const [series, count] of Object.entries(expectedSeriesCounts)) {
      expect(MARD_STANDARD_221_PALETTE.colors.filter((color) => color.series === series).map((color) => color.code)).toEqual(
        Array.from({ length: count }, (_, index) => `${series}${index + 1}`),
      );
    }
  });

  it('matches the checked PixelBeads source fingerprint', () => {
    const canonical = JSON.stringify(
      MARD_STANDARD_221_PALETTE.colors.map((color) => ({ code: color.code, hex: color.srgbHex })),
    );
    const digest = createHash('sha256').update(canonical).digest('hex');

    expect(digest).toBe(MARD_STANDARD_221_DATA_SHA256);
    expect(MARD_STANDARD_221_PALETTE.colors.find((color) => color.code === 'A1')?.srgbHex).toBe('#FAF4C8');
    expect(MARD_STANDARD_221_PALETTE.colors.find((color) => color.code === 'H7')?.srgbHex).toBe('#000000');
    expect(MARD_STANDARD_221_PALETTE.colors.find((color) => color.code === 'M15')?.srgbHex).toBe('#757D78');
  });
});
