import { describe, expect, it } from 'vitest';
import { paletteFromCsv, validatePaletteManifest } from './palette';

describe('palette import', () => {
  it('imports the documented CSV columns', () => {
    const palette = paletteFromCsv('code,hex,name,series\nA1,#ffffff,White,A\nH7,#000000,Black,H\n', 'sample.csv');
    expect(palette.colors).toHaveLength(2);
    expect(palette.colors[0]).toMatchObject({ code: 'A1', srgbHex: '#FFFFFF', name: 'White' });
  });

  it('rejects duplicate codes', () => {
    expect(() =>
      validatePaletteManifest({
        schemaVersion: 1,
        id: 'duplicate',
        brand: 'Test',
        edition: 'Test',
        version: '1',
        source: { label: 'test' },
        colors: [
          { id: 'one', code: 'A1', srgbHex: '#FFFFFF' },
          { id: 'two', code: 'a1', srgbHex: '#000000' },
        ],
      }),
    ).toThrow('重复色号');
  });
});
