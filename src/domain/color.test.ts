import { describe, expect, it } from 'vitest';
import { deltaE2000, hexToLab, hexToRgb } from './color';

describe('color utilities', () => {
  it('normalizes hex colors into RGB', () => {
    expect(hexToRgb('#fA8040')).toEqual({ r: 250, g: 128, b: 64 });
  });

  it('matches the Sharma CIEDE2000 reference pair', () => {
    const distance = deltaE2000(
      { l: 50, a: 2.6772, b: -79.7751 },
      { l: 50, a: 0, b: -82.7485 },
    );
    expect(distance).toBeCloseTo(2.0425, 4);
  });

  it('maps black and white to the expected Lab lightness range', () => {
    expect(hexToLab('#000000').l).toBeCloseTo(0, 5);
    expect(hexToLab('#FFFFFF').l).toBeCloseTo(100, 3);
  });
});
