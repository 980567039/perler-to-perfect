export const EMPTY_CELL = 0xffff;
export const MAX_GRID_SIDE = 300;
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_SOURCE_PIXELS = 40_000_000;
export const PROJECT_SCHEMA_VERSION = 1 as const;
export const ALGORITHM_VERSION = '0.2.0';

export interface GridSize {
  columns: number;
  rows: number;
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
  /** Optional crop box in normalized image coordinates; used when fit === 'crop' */
  cropBox?: CropBox;
  maxUsedColors: number;
  enabledColorIds: string[];
  lockedColorIds: string[];
  cleanupRegionSize: 0 | 1 | 2 | 3 | 4;
  detailPriority: boolean;
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
  bitmap: ImageBitmap;
  palette: PaletteManifest;
  settings: GenerationSettings;
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
    }
  | {
      type: 'RESULT';
      jobId: string;
      grid: GridSize;
      cells: ArrayBuffer;
      counts: ColorCount[];
      totalBeads: number;
      selectedPaletteIndices: number[];
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
    fit: 'contain',
    transform: { scale: 1, offsetX: 0, offsetY: 0 },
    maxUsedColors: 16,
    enabledColorIds: palette.colors.map((color) => color.id),
    lockedColorIds: [],
    cleanupRegionSize: 2,
    detailPriority: true,
  };
}
