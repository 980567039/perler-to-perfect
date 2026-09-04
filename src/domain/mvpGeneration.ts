import { hexToRgb } from './color';
import { countCells, validateGridSize } from './grid';
import { GenerationCancelledError } from './generation';
import {
  EMPTY_CELL,
  type GenerationSettings,
  type GridSize,
  type PaletteManifest,
  type PatternResult,
  type RgbColor,
} from './types';

/**
 * The production generator for this branch intentionally mirrors mvp's
 * bead-engine.js: find the largest foreground, fit it into the board, sample
 * each output cell, and map it directly to the nearest palette color.
 *
 * There is deliberately no global color selection, close-color merging,
 * structure regularization, or automatic small-region cleanup here. Those
 * operations changed the source image before the user had a chance to edit
 * it, which was the main reason the previous output drifted from mvp.
 */

const BACKGROUND_THRESHOLD = 32;
const COVERAGE_THRESHOLD = 0.18;
const SAMPLE_AXIS = 4;

interface Pixel extends RgbColor {
  a: number;
}

interface OklabColor {
  l: number;
  a: number;
  b: number;
}

interface BackgroundEstimate {
  color: RgbColor;
  reliable: boolean;
}

interface ForegroundRegion {
  bounds: { x: number; y: number; width: number; height: number };
  contains: (x: number, y: number) => boolean;
}

export interface MvpGenerationProgress {
  stage: 'sample' | 'map';
  completed: number;
  total: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pixelAt(imageData: ImageData, x: number, y: number): Pixel {
  const safeX = clamp(Math.round(x), 0, imageData.width - 1);
  const safeY = clamp(Math.round(y), 0, imageData.height - 1);
  const offset = (safeY * imageData.width + safeX) * 4;
  return {
    r: imageData.data[offset] ?? 0,
    g: imageData.data[offset + 1] ?? 0,
    b: imageData.data[offset + 2] ?? 0,
    a: imageData.data[offset + 3] ?? 0,
  };
}

function colorDistance(first: RgbColor, second: RgbColor): number {
  return Math.hypot(first.r - second.r, first.g - second.g, first.b - second.b);
}

function estimateBackground(imageData: ImageData): BackgroundEstimate {
  const points = [
    [0, 0],
    [imageData.width - 1, 0],
    [0, imageData.height - 1],
    [imageData.width - 1, imageData.height - 1],
    [imageData.width / 2, 1],
    [imageData.width / 2, imageData.height - 2],
  ] as const;
  let samples = points.map(([x, y]) => pixelAt(imageData, x, y)).filter((pixel) => pixel.a > 24);

  // Crop/contain previewing can leave transparent bars around an otherwise
  // opaque source image. In that case, use the visible image bounding-box
  // edge as mvp's equivalent background samples.
  if (samples.length === 0) {
    let minX = imageData.width;
    let minY = imageData.height;
    let maxX = -1;
    let maxY = -1;
    for (let row = 0; row < imageData.height; row += 1) {
      for (let column = 0; column < imageData.width; column += 1) {
        if (pixelAt(imageData, column, row).a <= 24) continue;
        minX = Math.min(minX, column);
        minY = Math.min(minY, row);
        maxX = Math.max(maxX, column);
        maxY = Math.max(maxY, row);
      }
    }
    if (maxX >= minX && maxY >= minY) {
      const bboxPoints = [
        [minX, minY],
        [maxX, minY],
        [minX, maxY],
        [maxX, maxY],
        [(minX + maxX) / 2, minY],
        [(minX + maxX) / 2, maxY],
      ] as const;
      samples = bboxPoints.map(([x, y]) => pixelAt(imageData, x, y)).filter((pixel) => pixel.a > 24);
    }
  }

  if (samples.length === 0) {
    return { color: { r: 255, g: 255, b: 255 }, reliable: false };
  }

  const color = {
    r: Math.round(samples.reduce((sum, pixel) => sum + pixel.r, 0) / samples.length),
    g: Math.round(samples.reduce((sum, pixel) => sum + pixel.g, 0) / samples.length),
    b: Math.round(samples.reduce((sum, pixel) => sum + pixel.b, 0) / samples.length),
  };
  const spread = Math.max(...samples.map((sample) => colorDistance(sample, color)));
  return { color, reliable: samples.length >= 4 && spread <= 72 };
}

function backgroundDistance(pixel: Pixel, background: BackgroundEstimate): number {
  if (pixel.a < 24) return 0;
  if (!background.reliable) return Number.POSITIVE_INFINITY;
  return colorDistance(pixel, background.color);
}

function buildForegroundRegion(
  imageData: ImageData,
  background: BackgroundEstimate,
  threshold: number,
): ForegroundRegion {
  const step = Math.max(1, Math.ceil(Math.max(imageData.width, imageData.height) / 420));
  const width = Math.max(1, Math.ceil(imageData.width / step));
  const height = Math.max(1, Math.ceil(imageData.height / step));
  const foreground = new Uint8Array(width * height);

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const pixel = pixelAt(imageData, column * step, row * step);
      foreground[row * width + column] =
        pixel.a > 24 && backgroundDistance(pixel, background) >= threshold ? 1 : 0;
    }
  }

  const visited = new Uint8Array(foreground.length);
  let best: number[] = [];
  const directions = [-1, 0, 1] as const;

  for (let start = 0; start < foreground.length; start += 1) {
    if (foreground[start] === 0 || visited[start] === 1) continue;
    const component = [start];
    visited[start] = 1;
    let cursor = 0;
    while (cursor < component.length) {
      const index = component[cursor];
      cursor += 1;
      if (index === undefined) break;
      const column = index % width;
      const row = Math.floor(index / width);
      for (const rowOffset of directions) {
        for (const columnOffset of directions) {
          if (rowOffset === 0 && columnOffset === 0) continue;
          const nextColumn = column + columnOffset;
          const nextRow = row + rowOffset;
          if (nextColumn < 0 || nextRow < 0 || nextColumn >= width || nextRow >= height) continue;
          const next = nextRow * width + nextColumn;
          if (foreground[next] === 1 && visited[next] === 0) {
            visited[next] = 1;
            component.push(next);
          }
        }
      }
    }
    if (component.length > best.length) best = component;
  }

  if (best.length === 0) {
    return {
      bounds: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      contains: () => true,
    };
  }

  const componentMask = new Uint8Array(foreground.length);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const index of best) {
    componentMask[index] = 1;
    const column = index % width;
    const row = Math.floor(index / width);
    minX = Math.min(minX, column);
    minY = Math.min(minY, row);
    maxX = Math.max(maxX, column);
    maxY = Math.max(maxY, row);
  }

  return {
    bounds: {
      x: minX * step,
      y: minY * step,
      width: Math.min(imageData.width, (maxX - minX + 1) * step),
      height: Math.min(imageData.height, (maxY - minY + 1) * step),
    },
    contains(x, y) {
      const column = Math.floor(x / step);
      const row = Math.floor(y / step);
      return column >= 0 && row >= 0 && column < width && row < height
        ? componentMask[row * width + column] === 1
        : false;
    },
  };
}

function srgbToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function rgbToOklab(rgb: RgbColor): OklabColor {
  const red = srgbToLinear(rgb.r);
  const green = srgbToLinear(rgb.g);
  const blue = srgbToLinear(rgb.b);
  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  return {
    l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
}

function oklabDistance(first: OklabColor, second: OklabColor): number {
  return Math.hypot(first.l - second.l, first.a - second.a, first.b - second.b);
}

function sampleCell(
  imageData: ImageData,
  bounds: ForegroundRegion['bounds'],
  region: ForegroundRegion,
  column: number,
  row: number,
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number,
  background: BackgroundEstimate,
): { coverage: number; rgb: RgbColor | null } {
  const sourceX0 = bounds.x + ((column - targetX) / targetWidth) * bounds.width;
  const sourceY0 = bounds.y + ((row - targetY) / targetHeight) * bounds.height;
  const sourceX1 = bounds.x + ((column + 1 - targetX) / targetWidth) * bounds.width;
  const sourceY1 = bounds.y + ((row + 1 - targetY) / targetHeight) * bounds.height;
  let foreground = 0;
  let red = 0;
  let green = 0;
  let blue = 0;

  for (let sampleY = 0; sampleY < SAMPLE_AXIS; sampleY += 1) {
    for (let sampleX = 0; sampleX < SAMPLE_AXIS; sampleX += 1) {
      const x = sourceX0 + ((sampleX + 0.5) / SAMPLE_AXIS) * (sourceX1 - sourceX0);
      const y = sourceY0 + ((sampleY + 0.5) / SAMPLE_AXIS) * (sourceY1 - sourceY0);
      const pixel = pixelAt(imageData, x, y);
      if (
        region.contains(x, y) &&
        pixel.a > 24 &&
        backgroundDistance(pixel, background) >= BACKGROUND_THRESHOLD
      ) {
        foreground += 1;
        red += pixel.r;
        green += pixel.g;
        blue += pixel.b;
      }
    }
  }

  if (foreground === 0) return { coverage: 0, rgb: null };
  return {
    coverage: foreground / (SAMPLE_AXIS * SAMPLE_AXIS),
    rgb: {
      r: red / foreground,
      g: green / foreground,
      b: blue / foreground,
    },
  };
}

function nearestPaletteIndex(rgb: RgbColor, paletteLabs: Array<OklabColor | null>, enabledIndices: number[]): number {
  const source = rgbToOklab(rgb);
  let winner = enabledIndices[0] ?? EMPTY_CELL;
  let distance = Number.POSITIVE_INFINITY;
  for (const paletteIndex of enabledIndices) {
    const candidate = paletteLabs[paletteIndex];
    if (!candidate) continue;
    const nextDistance = oklabDistance(source, candidate);
    if (nextDistance < distance - 1e-12 || (Math.abs(nextDistance - distance) <= 1e-12 && paletteIndex < winner)) {
      distance = nextDistance;
      winner = paletteIndex;
    }
  }
  return winner;
}

function targetDimensions(grid: GridSize, aspectRatio: number): { width: number; height: number; x: number; y: number } {
  // Keep one empty cell around the design so the first bead never touches the
  // board edge. The previous centered placement left five empty rows around
  // the common 104×104 design, making it harder to align the printed sheet
  // with the physical board. Production sheets are now anchored at (1, 1)
  // and use all remaining cells; any aspect-ratio remainder stays on the
  // right/bottom instead of shifting the artwork away from the origin.
  const marginX = grid.columns > 2 ? 1 : 0;
  const marginY = grid.rows > 2 ? 1 : 0;
  const maxWidth = Math.max(1, grid.columns - marginX * 2);
  const maxHeight = Math.max(1, grid.rows - marginY * 2);
  let height = maxHeight;
  let width = Math.max(1, Math.round(height * aspectRatio));
  if (width > maxWidth) {
    width = maxWidth;
    height = Math.max(1, Math.round(width / Math.max(0.0001, aspectRatio)));
  }
  return {
    width,
    height,
    x: marginX,
    y: marginY,
  };
}

function enabledPaletteIndices(palette: PaletteManifest, settings: GenerationSettings): number[] {
  const indexById = new Map(palette.colors.map((color, index) => [color.id, index]));
  const enabled = settings.enabledColorIds
    .map((id) => indexById.get(id))
    .filter((index): index is number => index !== undefined);
  const unique = [...new Set(enabled)];
  if (unique.length === 0) throw new Error('至少需要一个可用色号。');
  return unique;
}

export function generateMvpPattern(
  sampledImage: ImageData,
  palette: PaletteManifest,
  settings: GenerationSettings,
  options: {
    onProgress?: (progress: MvpGenerationProgress) => void;
    isCancelled?: () => boolean;
  } = {},
): PatternResult {
  validateGridSize(settings.grid);
  if (sampledImage.width < 1 || sampledImage.height < 1) throw new Error('采样图尺寸无效。');
  const checkCancelled = () => {
    if (options.isCancelled?.()) throw new GenerationCancelledError();
  };
  const enabledIndices = enabledPaletteIndices(palette, settings);
  const paletteLabs = palette.colors.map((color) => rgbToOklab(hexToRgb(color.srgbHex)));
  const background = estimateBackground(sampledImage);
  const region = buildForegroundRegion(sampledImage, background, BACKGROUND_THRESHOLD);
  const bounds = region.bounds;
  const aspectRatio = bounds.width / Math.max(1, bounds.height);
  const target = targetDimensions(settings.grid, aspectRatio);
  const cells = new Uint16Array(settings.grid.columns * settings.grid.rows);
  cells.fill(EMPTY_CELL);

  for (let row = target.y; row < target.y + target.height; row += 1) {
    checkCancelled();
    for (let column = target.x; column < target.x + target.width; column += 1) {
      const sample = sampleCell(
        sampledImage,
        bounds,
        region,
        column,
        row,
        target.x,
        target.y,
        target.width,
        target.height,
        background,
      );
      if (sample.coverage < COVERAGE_THRESHOLD || !sample.rgb) continue;
      cells[row * settings.grid.columns + column] = nearestPaletteIndex(sample.rgb, paletteLabs, enabledIndices);
    }
    options.onProgress?.({ stage: 'sample', completed: row - target.y + 1, total: target.height });
  }
  options.onProgress?.({ stage: 'map', completed: 1, total: 1 });

  const { counts, totalBeads } = countCells(cells, settings.grid, palette);
  return {
    grid: settings.grid,
    cells,
    counts,
    totalBeads,
    selectedPaletteIndices: counts.map((entry) => entry.paletteIndex),
  };
}
