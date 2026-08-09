import { z } from 'zod';
import { encodeCellsRle, validateGridSize } from '../domain/grid';
import { validatePaletteManifest } from '../domain/palette';
import {
  ALGORITHM_VERSION,
  PROJECT_SCHEMA_VERSION,
  type GenerationSettings,
  type PaletteManifest,
  type PatternProjectV1,
  type SourceMetadata,
} from '../domain/types';

const rleSchema = z.array(z.tuple([z.number().int().min(0).max(0xffff), z.number().int().min(1)]));

const settingsSchema = z.object({
  grid: z.object({ columns: z.number().int(), rows: z.number().int() }),
  fit: z.enum(['contain', 'crop']),
  transform: z.object({ scale: z.number().positive(), offsetX: z.number(), offsetY: z.number() }),
  cropBox: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    })
    .optional(),
  maxUsedColors: z.number().int().min(2).max(64),
  minimumPaletteDistance: z.number().min(0).max(12).default(4),
  enabledColorIds: z.array(z.string()),
  lockedColorIds: z.array(z.string()),
  cleanupRegionSize: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  detailPriority: z.boolean().default(true),
  sourceMode: z.enum(['original', 'bead-source']).optional().default('original'),
  renderProfile: z.enum(['shape', 'balanced', 'detail']).optional().default('balanced'),
  structureStrength: z.number().min(0).max(1).optional().default(0.6),
});

const sourceSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  sha256: z.string(),
  thumbnailDataUrl: z.string().optional(),
});

const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  algorithmVersion: z.string(),
  watermarkEnabled: z.boolean().default(true),
  palette: z.unknown(),
  settings: settingsSchema,
  cellsRle: rleSchema,
  source: sourceSchema,
});

export interface ProjectSnapshotInput {
  projectId: string;
  projectName: string;
  createdAt: string;
  palette: PaletteManifest;
  settings: GenerationSettings;
  watermarkEnabled: boolean;
  cells: Uint16Array;
  source: SourceMetadata;
}

export function createProjectSnapshot(input: ProjectSnapshotInput): PatternProjectV1 {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: input.projectId,
    name: input.projectName.trim() || '未命名拼豆图纸',
    createdAt: input.createdAt,
    updatedAt: new Date().toISOString(),
    algorithmVersion: ALGORITHM_VERSION,
    watermarkEnabled: input.watermarkEnabled,
    palette: input.palette,
    settings: input.settings,
    cellsRle: encodeCellsRle(input.cells),
    source: input.source,
  };
}

export function serializeProject(project: PatternProjectV1): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function parseProject(text: string): PatternProjectV1 {
  const parsed = projectSchema.parse(JSON.parse(text) as unknown);
  const palette = validatePaletteManifest(parsed.palette);
  validateGridSize(parsed.settings.grid);
  const runLength = parsed.cellsRle.reduce((total, [, length]) => total + length, 0);
  if (runLength !== parsed.settings.grid.columns * parsed.settings.grid.rows) {
    throw new Error('工程文件的网格长度与尺寸不一致。');
  }
  return { ...parsed, palette } as PatternProjectV1;
}

export async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function downloadTextFile(contents: string, fileName: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function safeFileStem(name: string): string {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '') || 'perler-pattern'
  );
}
