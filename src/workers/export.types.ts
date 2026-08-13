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

export interface MasterExportRequest {
  type: 'EXPORT_MASTER';
  jobId: string;
  grid: GridSize;
  cells: ArrayBuffer;
  palette: PaletteManifest;
  watermarkEnabled: boolean;
}

export type PatternExportRequest = ExportRequest | MasterExportRequest;

export type ExportResponse =
  | { type: 'PROGRESS'; jobId: string; completed: number; total: number; stage: string }
  | {
      type: 'RESULT';
      jobId: string;
      grid: ArrayBuffer;
      beads: ArrayBuffer;
      ironed: ArrayBuffer;
      archive: ArrayBuffer;
    }
  | { type: 'MASTER_RESULT'; jobId: string; master: ArrayBuffer }
  | { type: 'ERROR'; jobId: string; message: string };
