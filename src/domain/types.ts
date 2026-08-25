export const EMPTY_CELL = 0xffff;
export const MAX_GRID_SIDE = 300;
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_SOURCE_PIXELS = 40_000_000;
export const PROJECT_SCHEMA_VERSION = 1 as const;
export const ALGORITHM_VERSION = '0.4.0';

export interface GridSize {
  columns: number;
  rows: number;
}

export type PatternVisualMode = 'beads' | 'grid' | 'ironed';

export type SubjectEnhancementMode = 'local' | 'openai-hints';

export interface SubjectFocusRegion {
  x: number;
  y: number;
  radius: number;
  kind: 'face' | 'eye' | 'outline' | 'accessory';
  confidence: number;
}

/** Normalized, model-assisted hints. The local generator remains authoritative. */
export interface SubjectHints {
  bbox: { x: number; y: number; width: number; height: number };
  foregroundSeeds: Array<{ x: number; y: number; kind: 'inside' | 'outside' }>;
  focusRegions: SubjectFocusRegion[];
  confidence: number;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface LabColor {
  l: number;
  a: number;
  b: number;
}

export interface BeadColor {
  id: string;
  code: string;
  name?: string;
  srgbHex: `#${string}`;
  labD65?: LabColor;
  series?: string;
  tags?: string[];
}

export interface PaletteSource {
  label: string;
  url?: string;
  license?: string;
  retrievedAt?: string;
}

export interface PaletteManifest {
  schemaVersion: 1;
  id: string;
  brand: string;
  edition: string;
  version: string;
  source: PaletteSource;
  colors: BeadColor[];
}

/**
 * Crop box in normalized preview/grid coordinates (0–1).
 * Defines which portion of the framed image is mapped into the grid.
 */
export interface CropBox {
  /** Left edge, 0 = preview left, 1 = preview right */
  x: number;
  /** Top edge, 0 = preview top, 1 = preview bottom */
  y: number;
  /** Width fraction, must be > 0 */
  width: number;
  /** Height fraction, must be > 0 */
  height: number;
}

export interface GenerationSettings {
  grid: GridSize;
  fit: 'contain' | 'crop';
  transform: {
    scale: number;
    offsetX: number;
    offsetY: number;
  };
  /** Optional crop box in normalized preview/grid coordinates. */
  cropBox?: CropBox;
  maxUsedColors: number;
  /** Minimum CIEDE2000 distance between automatically selected palette colors. */
  minimumPaletteDistance: number;
  enabledColorIds: string[];
  lockedColorIds: string[];
  cleanupRegionSize: 0 | 1 | 2 | 3 | 4;
  detailPriority: boolean;
  /** Source generated specifically for gridding, or a general raster image. */
  sourceMode?: 'original' | 'bead-source';
  /** The product-facing trade-off, replacing opaque cleanup-only tuning. */
  renderProfile?: 'simple' | 'shape' | 'balanced' | 'detail';
  /** 0–1 region-consistency strength. Omitted values preserve V1 projects. */
  structureStrength?: number;
  /** Optional cloud-assisted subject hints; defaults to local-only processing. */
  subjectEnhancement?: SubjectEnhancementMode;
}

export type CellReason = 'flat' | 'edge' | 'detail' | 'noise';

export interface PatternDiagnostics {
  /** 0–255: larger values mean the palette decision is less ambiguous. */
  confidence: Uint8Array;
  reasons: CellReason[];
  structureScore: number;
  noiseScore: number;
}

export interface PatternDiagnosticsPayload {
  confidence: ArrayBuffer;
  reasons: CellReason[];
  structureScore: number;
  noiseScore: number;
}

export interface ColorCount {
  colorId: string;
  paletteIndex: number;
  count: number;
}

export interface PatternResult {
  grid: GridSize;
  cells: Uint16Array;
  counts: ColorCount[];
  totalBeads: number;
  selectedPaletteIndices: number[];
  diagnostics?: PatternDiagnostics;
}

export interface SourceMetadata {
  fileName: string;
  mimeType: string;
  sha256: string;
  thumbnailDataUrl?: string;
}

export interface PatternProjectV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  algorithmVersion: string;
  watermarkEnabled: boolean;
  palette: PaletteManifest;
  settings: GenerationSettings;
  cellsRle: Array<[cellIndex: number, runLength: number]>;
  source: SourceMetadata;
}

export interface GeneratePayload {
  type: 'GENERATE';
  jobId: string;
  bitmap?: ImageBitmap;
  /** A pre-sampled grid image returned by the optional Perfect Pixel service. */
  sampledImage?: ImageData;
  palette: PaletteManifest;
  settings: GenerationSettings;
  subjectHints?: SubjectHints;
}

export interface CancelPayload {
  type: 'CANCEL';
  jobId: string;
}

export type GenerateRequest = GeneratePayload | CancelPayload;

export type GenerateResponse =
  | {
      type: 'PROGRESS';
      jobId: string;
      stage: 'prepare' | 'sample' | 'select' | 'map' | 'cleanup';
      completed: number;
      total: number;
      engine?: 'perfect-pixel' | 'local-fallback';
    }
  | {
      type: 'RESULT';
      jobId: string;
      grid: GridSize;
      cells: ArrayBuffer;
      counts: ColorCount[];
      totalBeads: number;
      selectedPaletteIndices: number[];
      diagnostics?: PatternDiagnosticsPayload;
    }
  | {
      type: 'ERROR';
      jobId: string;
      code: string;
      message: string;
    };

export const DEFAULT_GRID: GridSize = { columns: 104, rows: 104 };

export function createDefaultSettings(palette: PaletteManifest): GenerationSettings {
  return {
    grid: { ...DEFAULT_GRID },
    fit: 'crop',
    transform: { scale: 1, offsetX: 0, offsetY: 0 },
    maxUsedColors: 16,
    // Match mvp's default: sample and map first; do not merge close shades
    // unless the user explicitly enables the advanced cleanup behavior.
    minimumPaletteDistance: 0,
    enabledColorIds: palette.colors.map((color) => color.id),
    lockedColorIds: [],
    cleanupRegionSize: 0,
    detailPriority: true,
    sourceMode: 'original',
    renderProfile: 'simple',
    structureStrength: 0,
    subjectEnhancement: 'local',
  };
}
