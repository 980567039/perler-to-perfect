import { create } from 'zustand';
import { countCells, detectBorderBackground, findLargestNonEmptyRegion, findMagicWandRegion } from '../domain/grid';
import { MARD_STANDARD_221_PALETTE } from '../domain/mardPalette';
import {
  EMPTY_CELL,
  createDefaultSettings,
  type ColorCount,
  type GenerationSettings,
  type PaletteManifest,
  type PatternProjectV1,
  type PatternResult,
  type SourceMetadata,
} from '../domain/types';
import { decodeCellsRle } from '../domain/grid';

interface CellChange {
  index: number;
  before: number;
  after: number;
}

interface EditPatch {
  changes: CellChange[];
}

interface ProjectState {
  projectId: string;
  projectName: string;
  createdAt: string;
  palette: PaletteManifest;
  settings: GenerationSettings;
  cells: Uint16Array | null;
  counts: ColorCount[];
  totalBeads: number;
  selectedPaletteIndices: number[];
  source: SourceMetadata | null;
  history: EditPatch[];
  future: EditPatch[];
  manuallyEdited: Set<number>;
  backgroundPreview: number[];
  watermarkEnabled: boolean;
  revision: number;
  setProjectName: (name: string) => void;
  setSource: (source: SourceMetadata | null) => void;
  setWatermarkEnabled: (enabled: boolean) => void;
  setPalette: (palette: PaletteManifest) => void;
  updateSettings: (settings: GenerationSettings) => void;
  setPattern: (result: PatternResult) => void;
  paintCells: (indices: number[], value: number) => void;
  magicWand: (index: number) => number;
  keepLargestComponent: () => number;
  undo: () => void;
  redo: () => void;
  previewBorderBackground: () => void;
  cancelBackgroundPreview: () => void;
  applyBackgroundPreview: () => void;
  loadProject: (project: PatternProjectV1) => void;
  clearPattern: () => void;
}

function recalculate(cells: Uint16Array, state: Pick<ProjectState, 'settings' | 'palette'>) {
  return countCells(cells, state.settings.grid, state.palette);
}

function applyPatch(cells: Uint16Array, patch: EditPatch, direction: 'forward' | 'backward'): Uint16Array {
  const next = cells.slice();
  for (const change of patch.changes) {
    next[change.index] = direction === 'forward' ? change.after : change.before;
  }
  return next;
}

const initialCreatedAt = new Date().toISOString();

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectId: crypto.randomUUID(),
  projectName: '未命名拼豆图纸',
  createdAt: initialCreatedAt,
  palette: MARD_STANDARD_221_PALETTE,
  settings: createDefaultSettings(MARD_STANDARD_221_PALETTE),
  cells: null,
  counts: [],
  totalBeads: 0,
  selectedPaletteIndices: [],
  source: null,
  history: [],
  future: [],
  manuallyEdited: new Set<number>(),
  backgroundPreview: [],
  watermarkEnabled: true,
  revision: 0,

  setProjectName: (projectName) => set({ projectName, revision: get().revision + 1 }),
  setSource: (source) => set({ source, revision: get().revision + 1 }),
  setWatermarkEnabled: (watermarkEnabled) => set({ watermarkEnabled, revision: get().revision + 1 }),

  setPalette: (palette) =>
    set({
      palette,
      settings: createDefaultSettings(palette),
      cells: null,
      counts: [],
      totalBeads: 0,
      selectedPaletteIndices: [],
      history: [],
      future: [],
      manuallyEdited: new Set<number>(),
      backgroundPreview: [],
      revision: get().revision + 1,
    }),

  updateSettings: (settings) =>
    set({
      settings,
      cells: null,
      counts: [],
      totalBeads: 0,
      selectedPaletteIndices: [],
      history: [],
      future: [],
      manuallyEdited: new Set<number>(),
      backgroundPreview: [],
      revision: get().revision + 1,
    }),

  setPattern: (result) =>
    set({
      cells: result.cells,
      counts: result.counts,
      totalBeads: result.totalBeads,
      selectedPaletteIndices: result.selectedPaletteIndices,
      history: [],
      future: [],
      manuallyEdited: new Set<number>(),
      backgroundPreview: [],
      revision: get().revision + 1,
    }),

  paintCells: (indices, value) => {
    const state = get();
    if (!state.cells) return;
    if (value !== EMPTY_CELL && (value < 0 || value >= state.palette.colors.length)) return;
    const uniqueIndices = [...new Set(indices)].sort((a, b) => a - b);
    const changes: CellChange[] = [];
    for (const index of uniqueIndices) {
      if (index < 0 || index >= state.cells.length) continue;
      const before = state.cells[index];
      if (before === undefined || before === value) continue;
      changes.push({ index, before, after: value });
    }
    if (changes.length === 0) return;
    const patch = { changes };
    const cells = applyPatch(state.cells, patch, 'forward');
    const { counts, totalBeads } = recalculate(cells, state);
    const manuallyEdited = new Set(state.manuallyEdited);
    changes.forEach((change) => manuallyEdited.add(change.index));
    set({
      cells,
      counts,
      totalBeads,
      manuallyEdited,
      history: [...state.history, patch].slice(-200),
      future: [],
      backgroundPreview: [],
      revision: state.revision + 1,
    });
  },

  magicWand: (index) => {
    const state = get();
    if (!state.cells) return 0;
    const region = findMagicWandRegion(state.cells, state.settings.grid, index);
    if (region.length === 0) return 0;
    state.paintCells(region, EMPTY_CELL);
    return region.length;
  },

  keepLargestComponent: () => {
    const state = get();
    if (!state.cells) return 0;
    const largest = new Set(findLargestNonEmptyRegion(state.cells, state.settings.grid));
    const removable = [...state.cells.keys()].filter((index) => state.cells?.[index] !== EMPTY_CELL && !largest.has(index));
    if (removable.length === 0) return 0;
    state.paintCells(removable, EMPTY_CELL);
    return removable.length;
  },

  undo: () => {
    const state = get();
    const patch = state.history[state.history.length - 1];
    if (!state.cells || !patch) return;
    const cells = applyPatch(state.cells, patch, 'backward');
    const { counts, totalBeads } = recalculate(cells, state);
    set({
      cells,
      counts,
      totalBeads,
      history: state.history.slice(0, -1),
      future: [patch, ...state.future].slice(0, 200),
      backgroundPreview: [],
      revision: state.revision + 1,
    });
  },

  redo: () => {
    const state = get();
    const patch = state.future[0];
    if (!state.cells || !patch) return;
    const cells = applyPatch(state.cells, patch, 'forward');
    const { counts, totalBeads } = recalculate(cells, state);
    set({
      cells,
      counts,
      totalBeads,
      history: [...state.history, patch].slice(-200),
      future: state.future.slice(1),
      backgroundPreview: [],
      revision: state.revision + 1,
    });
  },

  previewBorderBackground: () => {
    const state = get();
    if (!state.cells) return;
    set({ backgroundPreview: detectBorderBackground(state.cells, state.settings.grid) });
  },
  cancelBackgroundPreview: () => set({ backgroundPreview: [] }),
  applyBackgroundPreview: () => {
    const state = get();
    if (state.backgroundPreview.length === 0) return;
    state.paintCells(state.backgroundPreview, EMPTY_CELL);
  },

  loadProject: (project) => {
    const settings = { ...project.settings, fit: 'crop' as const, detailPriority: project.settings.detailPriority ?? true };
    const cells = decodeCellsRle(project.cellsRle, settings.grid.columns * settings.grid.rows);
    const { counts, totalBeads } = countCells(cells, settings.grid, project.palette);
    set({
      projectId: project.id,
      projectName: project.name,
      createdAt: project.createdAt,
      palette: project.palette,
      settings,
      cells,
      counts,
      totalBeads,
      selectedPaletteIndices: counts.map((entry) => entry.paletteIndex),
      source: project.source,
      watermarkEnabled: project.watermarkEnabled ?? true,
      history: [],
      future: [],
      manuallyEdited: new Set<number>(),
      backgroundPreview: [],
      revision: get().revision + 1,
    });
  },

  clearPattern: () =>
    set({
      cells: null,
      counts: [],
      totalBeads: 0,
      selectedPaletteIndices: [],
      history: [],
      future: [],
      manuallyEdited: new Set<number>(),
      backgroundPreview: [],
      revision: get().revision + 1,
    }),
}));
