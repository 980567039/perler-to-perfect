import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_PALETTE } from './devPalette';
import { createDefaultSettings } from './types';

describe('default generation settings', () => {
  it('starts new projects at 104×104 with simple sampling defaults', () => {
    const settings = createDefaultSettings(DEVELOPMENT_PALETTE);

    expect(settings.grid).toEqual({ columns: 104, rows: 104 });
    expect(settings.detailPriority).toBe(true);
    expect(settings.minimumPaletteDistance).toBe(0);
    expect(settings.cleanupRegionSize).toBe(0);
    expect(settings.structureStrength).toBe(0);
    expect(settings.renderProfile).toBe('simple');
  });
});
