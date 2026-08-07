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
const MIN_MEAN_PALETTE_GAIN = 0.1;
const CLOSE_COLOR_REGIONAL_SUPPORT = 0.08;
const CLOSE_COLOR_MIN_MEAN_GAIN = 0.25;
const STRUCTURAL_DETAIL_MIN_DELTA_E = 8;
const STRUCTURAL_DETAIL_SUPPORT_RATIO = 0.0005;
const LOW_CONTRAST_CLEANUP_DELTA_E = 10;
const DETAIL_EDGE_PROTECTION_DELTA_E = 9;
const STANDARD_EDGE_PROTECTION_DELTA_E = 15;
const CLEANUP_PASSES = 2;

interface RepresentativeCell {
  bucketKey: number;
  rgb: RgbColor;
  lab: LabColor;
  detailWeight: number;
  edgeStrength: number;
}

interface HistogramBucket {
  key: number;
  rgb: RgbColor;
  lab: LabColor;
  weight: number;
  edgeWeight: number;
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
  detailPriority: boolean,
): RepresentativeCell | null {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  let visibleSamples = 0;
  let minimumLuminance = 255;
  let maximumLuminance = 0;
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
      const luminance = rgb.r * 0.2126 + rgb.g * 0.7152 + rgb.b * 0.0722;
      minimumLuminance = Math.min(minimumLuminance, luminance);
      maximumLuminance = Math.max(maximumLuminance, luminance);
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

  if (detailPriority && buckets.size > 1) {
    const dominantRgb = {
      r: winning.r / winning.count,
      g: winning.g / winning.count,
      b: winning.b / winning.count,
    };
    const minimumCoverage = Math.max(2, Math.ceil(visibleSamples * 0.2));
    let winningScore = winning.count;
    for (const [key, value] of buckets) {
      if (key === winningKey || value.count < minimumCoverage) continue;
      const candidateRgb = {
        r: value.r / value.count,
        g: value.g / value.count,
        b: value.b / value.count,
      };
      const distance = Math.hypot(
        candidateRgb.r - dominantRgb.r,
        candidateRgb.g - dominantRgb.g,
        candidateRgb.b - dominantRgb.b,
      );
      const contrast = Math.min(1, distance / Math.sqrt(3 * 255 * 255));
      const score = value.count + contrast * 9;
      if (score > winningScore + 1e-6 || (Math.abs(score - winningScore) <= 1e-6 && key < winningKey)) {
        winningKey = key;
        winning = value;
        winningScore = score;
      }
    }
  }

  const rgb = {
    r: Math.round(winning.r / winning.count),
    g: Math.round(winning.g / winning.count),
    b: Math.round(winning.b / winning.count),
  };
  const detailWeight = detailPriority ? 1 + Math.min(2, (maximumLuminance - minimumLuminance) / 128) : 1;
  return { bucketKey: colorBucketKey(rgb), rgb, lab: rgbToLab(rgb), detailWeight, edgeStrength: 0 };
}

function annotateEdgeStrength(representatives: Array<RepresentativeCell | null>, grid: GridSize): void {
  const { columns, rows } = grid;
  for (let index = 0; index < representatives.length; index += 1) {
    const representative = representatives[index];
    if (!representative) continue;
    const row = Math.floor(index / columns);
    const column = index % columns;
    let edgeStrength = 0;
    const neighbors = [
      row > 0 ? index - columns : -1,
      row + 1 < rows ? index + columns : -1,
      column > 0 ? index - 1 : -1,
      column + 1 < columns ? index + 1 : -1,
    ];
    for (const neighborIndex of neighbors) {
      if (neighborIndex < 0) continue;
      const neighbor = representatives[neighborIndex];
      if (!neighbor) continue;
      edgeStrength = Math.max(edgeStrength, deltaE2000(representative.lab, neighbor.lab));
    }
    representative.edgeStrength = edgeStrength;
  }
}

function validateGenerationSettings(settings: GenerationSettings, palette: PaletteManifest): number[] {
  validateGridSize(settings.grid);
  if (!Number.isInteger(settings.maxUsedColors) || settings.maxUsedColors < 2 || settings.maxUsedColors > 64) {
    throw new Error('实际用色上限必须是 2–64 的整数。');
  }
  if (!Number.isFinite(settings.minimumPaletteDistance) || settings.minimumPaletteDistance < 0 || settings.minimumPaletteDistance > 12) {
    throw new Error('相近色合并阈值必须在 0–12 之间。');
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
  const raw = new Map<number, { r: number; g: number; b: number; count: number; weight: number; edgeWeight: number }>();
  for (const representative of representatives) {
    if (!representative) continue;
    const current = raw.get(representative.bucketKey) ?? { r: 0, g: 0, b: 0, count: 0, weight: 0, edgeWeight: 0 };
    current.r += representative.rgb.r;
    current.g += representative.rgb.g;
    current.b += representative.rgb.b;
    current.count += 1;
    current.weight += representative.detailWeight;
    if (representative.edgeStrength >= STRUCTURAL_DETAIL_MIN_DELTA_E) {
      current.edgeWeight += representative.detailWeight;
    }
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
      return { key, rgb, lab: rgbToLab(rgb), weight: value.weight, edgeWeight: value.edgeWeight };
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
  paletteLabs: LabColor[],
  settings: GenerationSettings,
  checkCancelled: () => void,
): number[] {
  if (buckets.length === 0) return [];
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
  const totalWeight = buckets.reduce((total, bucket) => total + bucket.weight, 0);

  while (selectedEnabledIndices.length < settings.maxUsedColors) {
    checkCancelled();
    let bestEnabledPosition = -1;
    let bestScore = selectedEnabledIndices.length === 0 ? Number.POSITIVE_INFINITY : 0;
    let bestEdgeWeight = 0;
    let bestMaximumImprovement = 0;
    for (let enabledPosition = 0; enabledPosition < enabledIndices.length; enabledPosition += 1) {
      if (selectedSet.has(enabledPosition)) continue;
      let score = 0;
      let supportWeight = 0;
      let edgeWeight = 0;
      let maximumImprovement = 0;
      for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
        const bucket = buckets[bucketIndex];
        if (!bucket) continue;
        const distance = distances[bucketIndex * enabledIndices.length + enabledPosition] ?? Number.POSITIVE_INFINITY;
        if (selectedEnabledIndices.length === 0) {
          score += distance * bucket.weight;
        } else {
          const improvement = Math.max(0, (minDistances[bucketIndex] ?? Number.POSITIVE_INFINITY) - distance);
          score += improvement * bucket.weight;
          if (improvement > 1e-6) {
            supportWeight += bucket.weight;
            edgeWeight += bucket.edgeWeight;
            maximumImprovement = Math.max(maximumImprovement, improvement);
          }
        }
      }

      if (selectedEnabledIndices.length > 0 && settings.minimumPaletteDistance > 0) {
        const paletteIndex = enabledIndices[enabledPosition];
        const candidateLab = paletteIndex === undefined ? undefined : paletteLabs[paletteIndex];
        let minimumDistance = Number.POSITIVE_INFINITY;
        for (const selectedEnabledPosition of selectedEnabledIndices) {
          const selectedPaletteIndex = enabledIndices[selectedEnabledPosition];
          const selectedLab = selectedPaletteIndex === undefined ? undefined : paletteLabs[selectedPaletteIndex];
          if (candidateLab && selectedLab) minimumDistance = Math.min(minimumDistance, deltaE2000(candidateLab, selectedLab));
        }
        const meanGain = totalWeight > 0 ? score / totalWeight : 0;
        const supportRatio = totalWeight > 0 ? supportWeight / totalWeight : 0;
        const hasRegionalNeed = supportRatio >= CLOSE_COLOR_REGIONAL_SUPPORT && meanGain >= CLOSE_COLOR_MIN_MEAN_GAIN;
        if (minimumDistance < settings.minimumPaletteDistance && !hasRegionalNeed) continue;
      }

      const better =
        selectedEnabledIndices.length === 0
          ? score < bestScore - 1e-6
          : score > bestScore + 1e-6;
      if (better || (Math.abs(score - bestScore) <= 1e-6 && (bestEnabledPosition < 0 || enabledPosition < bestEnabledPosition))) {
        bestScore = score;
        bestEnabledPosition = enabledPosition;
        bestEdgeWeight = edgeWeight;
        bestMaximumImprovement = maximumImprovement;
      }
    }
    if (bestEnabledPosition < 0) break;
    if (selectedEnabledIndices.length > 0) {
      const meanGain = totalWeight > 0 ? bestScore / totalWeight : 0;
      const minimumStructuralSupport = Math.max(1, totalWeight * STRUCTURAL_DETAIL_SUPPORT_RATIO);
      const preservesStructure =
        bestEdgeWeight >= minimumStructuralSupport && bestMaximumImprovement >= STRUCTURAL_DETAIL_MIN_DELTA_E;
      if (bestScore <= 1e-6 || (meanGain < MIN_MEAN_PALETTE_GAIN && !preservesStructure)) break;
    }
    selectedSet.add(bestEnabledPosition);
    selectedEnabledIndices.push(bestEnabledPosition);
    updateMinDistances(bestEnabledPosition);
  }

  return selectedEnabledIndices;
}

function cleanupSmallRegions(
  source: Uint16Array,
  grid: GridSize,
  threshold: number,
  paletteLabs: LabColor[],
  lockedPaletteIndices: Set<number>,
  representatives: Array<RepresentativeCell | null>,
  detailPriority: boolean,
): Uint16Array {
  if (threshold <= 0) return source;
  const { columns, rows } = grid;
  const neighborOffsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;
  const edgeProtectionThreshold = detailPriority
    ? DETAIL_EDGE_PROTECTION_DELTA_E
    : STANDARD_EDGE_PROTECTION_DELTA_E;
  let output = source.slice();

  for (let pass = 0; pass < CLEANUP_PASSES; pass += 1) {
    const input = output;
    const nextOutput = input.slice();
    const visited = new Uint8Array(input.length);
    let changed = false;

    for (let start = 0; start < input.length; start += 1) {
      if (visited[start] === 1) continue;
      const target = input[start];
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
          if (visited[next] === 0 && input[next] === target) {
            visited[next] = 1;
            stack.push(next);
          }
        }
      }
      if (region.length > threshold || lockedPaletteIndices.has(target)) continue;

      const neighbors = new Map<
        number,
        { boundary: number; sourceFit: number; sourceFitSamples: number; edgeContrast: number; edgeSamples: number }
      >();
      for (const index of region) {
        const row = Math.floor(index / columns);
        const column = index % columns;
        const representative = representatives[index];
        for (const [rowOffset, columnOffset] of neighborOffsets) {
          const nextRow = row + rowOffset;
          const nextColumn = column + columnOffset;
          if (nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= columns) continue;
          const neighborIndex = nextRow * columns + nextColumn;
          const neighbor = input[neighborIndex];
          if (neighbor === undefined || neighbor === EMPTY_CELL || neighbor === target) continue;
          const stats = neighbors.get(neighbor) ?? {
            boundary: 0,
            sourceFit: 0,
            sourceFitSamples: 0,
            edgeContrast: 0,
            edgeSamples: 0,
          };
          stats.boundary += 1;
          const candidateLab = paletteLabs[neighbor];
          if (representative && candidateLab) {
            stats.sourceFit += deltaE2000(representative.lab, candidateLab);
            stats.sourceFitSamples += 1;
          }
          const neighborRepresentative = representatives[neighborIndex];
          if (representative && neighborRepresentative) {
            stats.edgeContrast += deltaE2000(representative.lab, neighborRepresentative.lab);
            stats.edgeSamples += 1;
          }
          neighbors.set(neighbor, stats);
        }
      }

      const targetLab = paletteLabs[target];
      let replacement = -1;
      let bestBoundary = -1;
      let bestSourceFit = Number.POSITIVE_INFINITY;
      let bestPaletteDistance = Number.POSITIVE_INFINITY;
      let bestEdgeContrast = 0;
      for (const [candidate, stats] of neighbors) {
        const candidateLab = paletteLabs[candidate];
        const paletteDistance = targetLab && candidateLab
          ? deltaE2000(targetLab, candidateLab)
          : Number.POSITIVE_INFINITY;
        const sourceFit = stats.sourceFitSamples > 0
          ? stats.sourceFit / stats.sourceFitSamples
          : Number.POSITIVE_INFINITY;
        const better =
          stats.boundary > bestBoundary ||
          (stats.boundary === bestBoundary && sourceFit < bestSourceFit - 1e-6) ||
          (stats.boundary === bestBoundary && Math.abs(sourceFit - bestSourceFit) <= 1e-6 && paletteDistance < bestPaletteDistance - 1e-6) ||
          (stats.boundary === bestBoundary && Math.abs(sourceFit - bestSourceFit) <= 1e-6 && Math.abs(paletteDistance - bestPaletteDistance) <= 1e-6 && candidate < replacement);
        if (!better) continue;
        replacement = candidate;
        bestBoundary = stats.boundary;
        bestSourceFit = sourceFit;
        bestPaletteDistance = paletteDistance;
        bestEdgeContrast = stats.edgeSamples > 0 ? stats.edgeContrast / stats.edgeSamples : 0;
      }

      const isLowContrastIsland = bestPaletteDistance <= LOW_CONTRAST_CLEANUP_DELTA_E;
      const hasSourceEdgeSupport = bestEdgeContrast >= edgeProtectionThreshold;
      if (replacement >= 0 && isLowContrastIsland && !hasSourceEdgeSupport) {
        region.forEach((index) => (nextOutput[index] = replacement));
        changed = true;
      }
    }

    output = nextOutput;
    if (!changed) break;
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
    representatives[index] = representativeForCell(
      sampledImage.data,
      sampledImage.width,
      row,
      column,
      settings.detailPriority,
    );
  }
  options.onProgress?.({ stage: 'sample', completed: cellCount, total: cellCount });
  annotateEdgeStrength(representatives, settings.grid);

  const { buckets, bucketIndexByKey } = buildHistogram(representatives);
  if (buckets.length === 0) {
    const emptyCells = new Uint16Array(cellCount);
    emptyCells.fill(EMPTY_CELL);
    return { grid: settings.grid, cells: emptyCells, counts: [], totalBeads: 0, selectedPaletteIndices: [] };
  }

  options.onProgress?.({ stage: 'select', completed: 0, total: 2 });
  const { distances, paletteLabs } = buildDistanceMatrix(buckets, palette, enabledIndices, checkCancelled);
  options.onProgress?.({ stage: 'select', completed: 1, total: 2 });
  const selectedEnabledIndices = selectPaletteIndices(
    buckets,
    palette,
    enabledIndices,
    distances,
    paletteLabs,
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
    representatives,
    settings.detailPriority,
  );
  options.onProgress?.({ stage: 'cleanup', completed: 1, total: 1 });
  const { counts, totalBeads } = countCells(cells, settings.grid, palette);
  return {
    grid: settings.grid,
    cells,
    counts,
    totalBeads,
    selectedPaletteIndices: counts.map((entry) => entry.paletteIndex),
  };
}

export const GENERATION_SAMPLE_SCALE = SAMPLE_SCALE;
