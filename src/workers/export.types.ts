import type { ColorCount, GridSize, PaletteManifest } from '../domain/types';

export interface ExportRequest {
  type: 'EXPORT';
  jobId: string;
  projectName: string;
  grid: GridSize;
  cells: ArrayBuffer;
  palette: PaletteManifest;
  counts: ColorCount[];
  totalBeads: number;
  tileSize: number;
  watermarkEnabled: boolean;
}

export type ExportResponse =
  | { type: 'PROGRESS'; jobId: string; completed: number; total: number; stage: string }
  | { type: 'RESULT'; jobId: string; master: ArrayBuffer; archive: ArrayBuffer }
  | { type: 'ERROR'; jobId: string; message: string };
