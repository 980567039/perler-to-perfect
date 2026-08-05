import { deltaE2000, hexToLab, rgbToLab } from './color';
import { countCells, validateGridSize } from './grid';
import {
  EMPTY_CELL,
  type GenerationSettings,
  type GridSize,
  type LabColor,
  type PaletteManifest,
  type PatternResult,
  type RgbColor,
} from './types';

const SAMPLE_SCALE = 4;

interface RepresentativeCell {
  bucketKey: number;
  rgb: RgbColor;
}

interface HistogramBucket {
  key: number;
  rgb: RgbColor;
  lab: LabColor;
  weight: number;
}

export interface GenerationProgress {
  stage: 'sample' | 'select' | 'map' | 'cleanup';
  completed: number;
  total: number;
}

export class GenerationCancelledError extends Error {
  constructor() {
    super('任务已取消。');
    this.name = 'GenerationCancelledError';
  }
}

function colorBucketKey(rgb: RgbColor): number {
  return ((rgb.r >> 4) << 8) | ((rgb.g >> 4) << 4) | (rgb.b >> 4);
}

function representativeForCell(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  cellRow: number,
  cellColumn: number,
): RepresentativeCell | null {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  let visibleSamples = 0;
  const startX = cellColumn * SAMPLE_SCALE;
  const startY = cellRow * SAMPLE_SCALE;
  for (let y = startY; y < startY + SAMPLE_SCALE; y += 1) {
    for (let x = startX; x < startX + SAMPLE_SCALE; x += 1) {
      const offset = (y * imageWidth + x) * 4;
      const alpha = pixels[offset + 3] ?? 0;
      if (alpha < 128) continue;
      const rgb = {
        r: pixels[offset] ?? 0,
        g: pixels[offset + 1] ?? 0,
        b: pixels[offset + 2] ?? 0,
      };
      const key = colorBucketKey(rgb);
      const current = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      current.count += 1;
      current.r += rgb.r;
      current.g += rgb.g;
      current.b += rgb.b;
      buckets.set(key, current);
      visibleSamples += 1;
    }
  }
  if (visibleSamples < SAMPLE_SCALE) return null;

  let winningKey = -1;
  let winning = { count: -1, r: 0, g: 0, b: 0 };
  for (const [key, value] of buckets) {
    if (value.count > winning.count || (value.count === winning.count && key < winningKey)) {
      winningKey = key;
      winning = value;
    }
  }

  const rgb = {
    r: Math.round(winning.r / winning.count),
    g: Math.round(winning.g / winning.count),
    b: Math.round(winning.b / winning.count),
  };
  return { bucketKey: colorBucketKey(rgb), rgb };
}

function validateGenerationSettings(settings: GenerationSettings, palette: PaletteManifest): number[] {
  validateGridSize(settings.grid);
  if (!Number.isInteger(settings.maxUsedColors) || settings.maxUsedColors < 2 || settings.maxUsedColors > 64) {
    throw new Error('实际用色上限必须是 2–64 的整数。');
  }
  const indexById = new Map(palette.colors.map((color, index) => [color.id, index]));
  const enabled = settings.enabledColorIds.map((id) => indexById.get(id)).filter((value): value is number => value !== undefined);
  const uniqueEnabled = [...new Set(enabled)];
  if (uniqueEnabled.length < 2) throw new Error('至少需要启用两个色号。');
  if (settings.maxUsedColors > uniqueEnabled.length) {
    throw new Error('实际用色上限不能大于已启用色号数量。');
  }
  const enabledSet = new Set(settings.enabledColorIds);
  if (settings.lockedColorIds.some((id) => !enabledSet.has(id))) {
    throw new Error('锁定色必须同时处于启用状态。');
  }
  if (settings.lockedColorIds.length > settings.maxUsedColors) {
    throw new Error('锁定色数量不能超过实际用色上限。');
  }
  return uniqueEnabled;
}

function buildHistogram(representatives: Array<RepresentativeCell | null>): {
  buckets: HistogramBucket[];
  bucketIndexByKey: Map<number, number>;
} {
  const raw = new Map<number, { r: number; g: number; b: number; count: number }>();
  for (const representative of representatives) {
    if (!representative) continue;
    const current = raw.get(representative.bucketKey) ?? { r: 0, g: 0, b: 0, count: 0 };
    current.r += representative.rgb.r;
    current.g += representative.rgb.g;
    current.b += representative.rgb.b;
    current.count += 1;
    raw.set(representative.bucketKey, current);
  }

  const buckets = [...raw.entries()]
    .sort(([first], [second]) => first - second)
    .map<HistogramBucket>(([key, value]) => {
      const rgb = {
        r: Math.round(value.r / value.count),
        g: Math.round(value.g / value.count),
        b: Math.round(value.b / value.count),
      };
      return { key, rgb, lab: rgbToLab(rgb), weight: value.count };
    });
  return { buckets, bucketIndexByKey: new Map(buckets.map((bucket, index) => [bucket.key, index])) };
}

function buildDistanceMatrix(
  buckets: HistogramBucket[],
  palette: PaletteManifest,
  enabledIndices: number[],
  checkCancelled: () => void,
): { distances: Float32Array; paletteLabs: LabColor[] } {
  const paletteLabs = palette.colors.map((color) => color.labD65 ?? hexToLab(color.srgbHex));
  const distances = new Float32Array(buckets.length * enabledIndices.length);
  for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
    if (bucketIndex % 128 === 0) checkCancelled();
    const bucket = buckets[bucketIndex];
    if (!bucket) continue;
    for (let enabledIndex = 0; enabledIndex < enabledIndices.length; enabledIndex += 1) {
      const paletteIndex = enabledIndices[enabledIndex];
      const paletteLab = paletteIndex === undefined ? undefined : paletteLabs[paletteIndex];
      if (!paletteLab) continue;
      distances[bucketIndex * enabledIndices.length + enabledIndex] = deltaE2000(bucket.lab, paletteLab);
    }
  }
  return { distances, paletteLabs };
}

function selectPaletteIndices(
  buckets: HistogramBucket[],
  palette: PaletteManifest,
  enabledIndices: number[],
  distances: Float32Array,
  settings: GenerationSettings,
  checkCancelled: () => void,
): { selectedPaletteIndices: number[]; selectedEnabledIndices: number[] } {
  if (buckets.length === 0) return { selectedPaletteIndices: [], selectedEnabledIndices: [] };
  const enabledPositionByPaletteIndex = new Map(enabledIndices.map((paletteIndex, position) => [paletteIndex, position]));
  const paletteIndexById = new Map(palette.colors.map((color, index) => [color.id, index]));
  const selectedEnabledIndices: number[] = [];
  const selectedSet = new Set<number>();
  for (const id of settings.lockedColorIds) {
    const paletteIndex = paletteIndexById.get(id);
    const enabledPosition = paletteIndex === undefined ? undefined : enabledPositionByPaletteIndex.get(paletteIndex);
    if (enabledPosition !== undefined && !selectedSet.has(enabledPosition)) {
      selectedSet.add(enabledPosition);
      selectedEnabledIndices.push(enabledPosition);
    }
  }

  const minDistances = new Float32Array(buckets.length);
  minDistances.fill(Number.POSITIVE_INFINITY);
  const updateMinDistances = (enabledPosition: number) => {
    for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
      const distance = distances[bucketIndex * enabledIndices.length + enabledPosition] ?? Number.POSITIVE_INFINITY;
      if (distance < (minDistances[bucketIndex] ?? Number.POSITIVE_INFINITY)) {
        minDistances[bucketIndex] = distance;
      }
    }
  };
  selectedEnabledIndices.forEach(updateMinDistances);

  while (selectedEnabledIndices.length < settings.maxUsedColors) {
    checkCancelled();
    let bestEnabledPosition = -1;
    let bestScore = selectedEnabledIndices.length === 0 ? Number.POSITIVE_INFINITY : 0;
    for (let enabledPosition = 0; enabledPosition < enabledIndices.length; enabledPosition += 1) {
      if (selectedSet.has(enabledPosition)) continue;
      let score = 0;
      for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
        const bucket = buckets[bucketIndex];
        if (!bucket) continue;
        const distance = distances[bucketIndex * enabledIndices.length + enabledPosition] ?? Number.POSITIVE_INFINITY;
        if (selectedEnabledIndices.length === 0) {
          score += distance * bucket.weight;
        } else {
          score += Math.max(0, (minDistances[bucketIndex] ?? Number.POSITIVE_INFINITY) - distance) * bucket.weight;
        }
      }
      const better =
        selectedEnabledIndices.length === 0
          ? score < bestScore - 1e-6
          : score > bestScore + 1e-6;
      if (better || (Math.abs(score - bestScore) <= 1e-6 && (bestEnabledPosition < 0 || enabledPosition < bestEnabledPosition))) {
        bestScore = score;
        bestEnabledPosition = enabledPosition;
      }
    }
    if (bestEnabledPosition < 0 || (selectedEnabledIndices.length > 0 && bestScore <= 1e-6)) break;
    selectedSet.add(bestEnabledPosition);
    selectedEnabledIndices.push(bestEnabledPosition);
    updateMinDistances(bestEnabledPosition);
  }

  return {
    selectedEnabledIndices,
    selectedPaletteIndices: selectedEnabledIndices
      .map((enabledPosition) => enabledIndices[enabledPosition])
      .filter((value): value is number => value !== undefined),
  };
}

function cleanupSmallRegions(
  source: Uint16Array,
  grid: GridSize,
  threshold: number,
  paletteLabs: LabColor[],
  lockedPaletteIndices: Set<number>,
): Uint16Array {
  if (threshold <= 0) return source;
  const { columns, rows } = grid;
  const visited = new Uint8Array(source.length);
  const output = source.slice();
  const neighborOffsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;

  for (let start = 0; start < source.length; start += 1) {
    if (visited[start] === 1) continue;
    const target = source[start];
    if (target === undefined || target === EMPTY_CELL) {
      visited[start] = 1;
      continue;
    }
    const stack = [start];
    const region: number[] = [];
    visited[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) break;
      region.push(index);
      const row = Math.floor(index / columns);
      const column = index % columns;
      for (const [rowOffset, columnOffset] of neighborOffsets) {
        const nextRow = row + rowOffset;
        const nextColumn = column + columnOffset;
        if (nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= columns) continue;
        const next = nextRow * columns + nextColumn;
        if (visited[next] === 0 && source[next] === target) {
          visited[next] = 1;
          stack.push(next);
        }
      }
    }
    if (region.length > threshold || lockedPaletteIndices.has(target)) continue;

    const neighbors = new Map<number, number>();
    for (const index of region) {
      const row = Math.floor(index / columns);
      const column = index % columns;
      for (const [rowOffset, columnOffset] of neighborOffsets) {
        const nextRow = row + rowOffset;
        const nextColumn = column + columnOffset;
        if (nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= columns) continue;
        const neighbor = source[nextRow * columns + nextColumn];
        if (neighbor === undefined || neighbor === EMPTY_CELL || neighbor === target) continue;
        neighbors.set(neighbor, (neighbors.get(neighbor) ?? 0) + 1);
      }
    }

    const sourceLab = paletteLabs[target];
    let replacement = -1;
    let bestBoundary = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [candidate, boundary] of neighbors) {
      const candidateLab = paletteLabs[candidate];
      const distance = sourceLab && candidateLab ? deltaE2000(sourceLab, candidateLab) : Number.POSITIVE_INFINITY;
      if (
        boundary > bestBoundary ||
        (boundary === bestBoundary && distance < bestDistance - 1e-6) ||
        (boundary === bestBoundary && Math.abs(distance - bestDistance) <= 1e-6 && candidate < replacement)
      ) {
        replacement = candidate;
        bestBoundary = boundary;
        bestDistance = distance;
      }
    }
    if (replacement >= 0) region.forEach((index) => (output[index] = replacement));
  }
  return output;
}

export function generatePattern(
  sampledImage: ImageData,
  palette: PaletteManifest,
  settings: GenerationSettings,
  options: {
    onProgress?: (progress: GenerationProgress) => void;
    isCancelled?: () => boolean;
  } = {},
): PatternResult {
  const enabledIndices = validateGenerationSettings(settings, palette);
  const expectedWidth = settings.grid.columns * SAMPLE_SCALE;
  const expectedHeight = settings.grid.rows * SAMPLE_SCALE;
  if (sampledImage.width !== expectedWidth || sampledImage.height !== expectedHeight) {
    throw new Error(`采样图尺寸必须为 ${expectedWidth}×${expectedHeight}。`);
  }
  const checkCancelled = () => {
    if (options.isCancelled?.()) throw new GenerationCancelledError();
  };

  const cellCount = settings.grid.columns * settings.grid.rows;
  const representatives: Array<RepresentativeCell | null> = new Array(cellCount).fill(null);
  for (let index = 0; index < cellCount; index += 1) {
    if (index % 1024 === 0) {
      checkCancelled();
      options.onProgress?.({ stage: 'sample', completed: index, total: cellCount });
    }
    const row = Math.floor(index / settings.grid.columns);
    const column = index % settings.grid.columns;
    representatives[index] = representativeForCell(sampledImage.data, sampledImage.width, row, column);
  }
  options.onProgress?.({ stage: 'sample', completed: cellCount, total: cellCount });

  const { buckets, bucketIndexByKey } = buildHistogram(representatives);
  if (buckets.length === 0) {
    const emptyCells = new Uint16Array(cellCount);
    emptyCells.fill(EMPTY_CELL);
    return { grid: settings.grid, cells: emptyCells, counts: [], totalBeads: 0, selectedPaletteIndices: [] };
  }

  options.onProgress?.({ stage: 'select', completed: 0, total: 2 });
  const { distances, paletteLabs } = buildDistanceMatrix(buckets, palette, enabledIndices, checkCancelled);
  options.onProgress?.({ stage: 'select', completed: 1, total: 2 });
  const { selectedPaletteIndices, selectedEnabledIndices } = selectPaletteIndices(
    buckets,
    palette,
    enabledIndices,
    distances,
    settings,
    checkCancelled,
  );
  options.onProgress?.({ stage: 'select', completed: 2, total: 2 });

  const paletteByBucket = new Uint16Array(buckets.length);
  for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
    let bestPaletteIndex = EMPTY_CELL;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const enabledPosition of selectedEnabledIndices) {
      const paletteIndex = enabledIndices[enabledPosition];
      if (paletteIndex === undefined) continue;
      const distance = distances[bucketIndex * enabledIndices.length + enabledPosition] ?? Number.POSITIVE_INFINITY;
      if (distance < bestDistance - 1e-6 || (Math.abs(distance - bestDistance) <= 1e-6 && paletteIndex < bestPaletteIndex)) {
        bestDistance = distance;
        bestPaletteIndex = paletteIndex;
      }
    }
    paletteByBucket[bucketIndex] = bestPaletteIndex;
  }

  const mapped = new Uint16Array(cellCount);
  mapped.fill(EMPTY_CELL);
  for (let index = 0; index < representatives.length; index += 1) {
    if (index % 2048 === 0) {
      checkCancelled();
      options.onProgress?.({ stage: 'map', completed: index, total: cellCount });
    }
    const representative = representatives[index];
    if (!representative) continue;
    const bucketIndex = bucketIndexByKey.get(representative.bucketKey);
    if (bucketIndex === undefined) continue;
    mapped[index] = paletteByBucket[bucketIndex] ?? EMPTY_CELL;
  }
  options.onProgress?.({ stage: 'map', completed: cellCount, total: cellCount });

  checkCancelled();
  options.onProgress?.({ stage: 'cleanup', completed: 0, total: 1 });
  const paletteIndexById = new Map(palette.colors.map((color, index) => [color.id, index]));
  const lockedPaletteIndices = new Set(
    settings.lockedColorIds
      .map((id) => paletteIndexById.get(id))
      .filter((value): value is number => value !== undefined),
  );
  const cells = cleanupSmallRegions(
    mapped,
    settings.grid,
    settings.cleanupRegionSize,
    paletteLabs,
    lockedPaletteIndices,
  );
  options.onProgress?.({ stage: 'cleanup', completed: 1, total: 1 });
  const { counts, totalBeads } = countCells(cells, settings.grid, palette);
  return { grid: settings.grid, cells, counts, totalBeads, selectedPaletteIndices };
}

export const GENERATION_SAMPLE_SCALE = SAMPLE_SCALE;
