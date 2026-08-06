import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_PALETTE } from '../domain/devPalette';
import { ALGORITHM_VERSION, createDefaultSettings } from '../domain/types';
import { parseProject } from './projectFile';

describe('project file compatibility', () => {
  it('enables detail priority when importing a legacy project without the field', () => {
    const legacySettings = { ...createDefaultSettings(DEVELOPMENT_PALETTE) };
    Reflect.deleteProperty(legacySettings, 'detailPriority');
    const project = {
      schemaVersion: 1,
      id: 'legacy-project',
      name: 'Legacy project',
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-06T00:00:00.000Z',
      algorithmVersion: ALGORITHM_VERSION,
      palette: DEVELOPMENT_PALETTE,
      settings: { ...legacySettings, grid: { columns: 1, rows: 1 } },
      cellsRle: [[0, 1]],
      source: { fileName: 'legacy.png', mimeType: 'image/png', sha256: 'legacy' },
    };

    expect(parseProject(JSON.stringify(project)).settings.detailPriority).toBe(true);
    expect(parseProject(JSON.stringify(project)).watermarkEnabled).toBe(true);
  });
});
