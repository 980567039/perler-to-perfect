import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_PALETTE } from './devPalette';
import { createDefaultSettings } from './types';

describe('default generation settings', () => {
  it('starts new projects at 104×104 with detail priority enabled', () => {
    const settings = createDefaultSettings(DEVELOPMENT_PALETTE);

    expect(settings.grid).toEqual({ columns: 104, rows: 104 });
    expect(settings.detailPriority).toBe(true);
  });
});
