import { contrastTextColor, hexToRgb } from '../domain/color';
import { EMPTY_CELL, type GridSize, type PaletteManifest, type PatternVisualMode, type RgbColor } from '../domain/types';
import { drawWatermark } from './watermark';

type PatternDrawingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface DrawPatternOptions {
  cells: Uint16Array;
  fullGrid: GridSize;
  palette: PaletteManifest;
  startRow: number;
  startColumn: number;
  rows: number;
  columns: number;
  cellPixels: number;
  visualMode: PatternVisualMode;
  showGridOverlay: boolean;
  watermarkEnabled: boolean;
  showCoordinates?: boolean;
  includeAxes?: boolean;
  /** Leave empty cells transparent so a reference image can show underneath. */
  preserveEmptyBackground?: boolean;
}

export function gridCanvasDimensions(columns: number, rows: number, cellPixels: number) {
  const axis = Math.max(36, cellPixels * 2);
  return {
    axis,
    width: columns * cellPixels + axis * 2,
    height: rows * cellPixels + axis * 2,
  };
}

export function visualCanvasDimensions(columns: number, rows: number, cellPixels: number) {
  return {
    width: Math.max(1, columns * cellPixels),
    height: Math.max(1, rows * cellPixels),
  };
}

function fitCellFont(context: PatternDrawingContext, code: string, cellPixels: number): number {
  let size = Math.max(5, Math.floor(cellPixels * 0.4));
  while (size > 5) {
    context.font = `700 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    if (context.measureText(code).width <= Math.max(3, cellPixels - 3)) break;
    size -= 1;
  }
  return size;
}

function colorString(rgb: RgbColor, alpha = 1): string {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function adjustColor(hex: string, amount: number): RgbColor {
  const rgb = hexToRgb(hex);
  return {
    r: Math.max(0, Math.min(255, Math.round(rgb.r + amount))),
    g: Math.max(0, Math.min(255, Math.round(rgb.g + amount))),
    b: Math.max(0, Math.min(255, Math.round(rgb.b + amount))),
  };
}

interface VisualTones {
  light: RgbColor;
  dark: RgbColor;
}

const BEAD_BOARD_COLOR = '#242321';

const visualToneCache = new Map<string, VisualTones>();

function tonesFor(hex: `#${string}`): VisualTones {
  const cached = visualToneCache.get(hex);
  if (cached) return cached;
  const tones = { light: adjustColor(hex, 36), dark: adjustColor(hex, -42) };
  visualToneCache.set(hex, tones);
  return tones;
}

function drawEmptyCell(context: PatternDrawingContext, x: number, y: number, cellPixels: number): void {
  context.fillStyle = '#F7F5F1';
  context.fillRect(x, y, cellPixels, cellPixels);
}

function drawFlatCell(
  context: PatternDrawingContext,
  x: number,
  y: number,
  cellPixels: number,
  color: { srgbHex: `#${string}`; code: string },
  showCode: boolean,
): void {
  context.fillStyle = color.srgbHex;
  context.fillRect(x, y, cellPixels, cellPixels);
  if (!showCode) return;
  context.save();
  context.beginPath();
  context.rect(x + 1, y + 1, Math.max(1, cellPixels - 2), Math.max(1, cellPixels - 2));
  context.clip();
  const fontSize = fitCellFont(context, color.code, cellPixels);
  context.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  context.fillStyle = contrastTextColor(color.srgbHex);
  context.fillText(color.code, x + cellPixels / 2, y + cellPixels / 2 + 0.25);
  context.restore();
}

function drawBead(context: PatternDrawingContext, x: number, y: number, cellPixels: number, hex: `#${string}`): void {
  const centerX = x + cellPixels / 2;
  const centerY = y + cellPixels / 2;
  // Beadify-style beads are distinct rings with breathing room around them,
  // rather than almost edge-to-edge filled circles.
  const radius = Math.max(0.7, cellPixels * 0.405);
  const shadowRadius = Math.max(0.6, radius * 1.02);
  const { light, dark } = tonesFor(hex);

  context.save();
  context.fillStyle = colorString({ r: 15, g: 23, b: 42 }, 0.2);
  context.beginPath();
  context.arc(centerX + radius * 0.06, centerY + radius * 0.11, shadowRadius, 0, Math.PI * 2);
  context.fill();

  const gradient = context.createRadialGradient(
    centerX - radius * 0.32,
    centerY - radius * 0.34,
    Math.max(0.4, radius * 0.08),
    centerX + radius * 0.15,
    centerY + radius * 0.18,
    radius * 1.08,
  );
  gradient.addColorStop(0, colorString(light));
  gradient.addColorStop(0.34, hex);
  gradient.addColorStop(0.84, hex);
  gradient.addColorStop(1, colorString(dark));
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fill();

  // Keep the opening proportional at every zoom level. The previous 2.3px
  // cap made zoomed-in beads look solid even though a small dot was present.
  const holeRadius = Math.max(0.32, radius * 0.43);
  const innerWallRadius = holeRadius * 1.18;
  context.fillStyle = colorString(dark, Math.min(0.82, 0.46 + cellPixels / 90));
  context.beginPath();
  context.arc(centerX, centerY + radius * 0.025, innerWallRadius, 0, Math.PI * 2);
  context.fill();

  // The center matches the board, so every occupied cell reads as a real
  // cylindrical bead with an open hole while exported PNGs remain opaque.
  context.fillStyle = BEAD_BOARD_COLOR;
  context.beginPath();
  context.arc(centerX, centerY, holeRadius, 0, Math.PI * 2);
  context.fill();

  if (cellPixels >= 5) {
    context.strokeStyle = colorString(light, 0.58);
    context.lineWidth = Math.max(0.4, cellPixels * 0.038);
    context.beginPath();
    context.arc(centerX - holeRadius * 0.03, centerY - holeRadius * 0.04, holeRadius * 1.05, Math.PI * 1.04, Math.PI * 1.76);
    context.stroke();

    context.strokeStyle = colorString({ r: 0, g: 0, b: 0 }, 0.38);
    context.lineWidth = Math.max(0.32, cellPixels * 0.032);
    context.beginPath();
    context.arc(centerX + holeRadius * 0.03, centerY + holeRadius * 0.05, holeRadius * 1.04, Math.PI * 0.04, Math.PI * 0.78);
    context.stroke();
  }
  context.restore();
}

function drawIronedCell(context: PatternDrawingContext, x: number, y: number, cellPixels: number, hex: `#${string}`): void {
  const bleed = Math.min(0.9, Math.max(0.12, cellPixels * 0.035));
  const { light: beadLight, dark: beadDark } = tonesFor(hex);
  const light = {
    r: Math.min(255, beadLight.r - 12),
    g: Math.min(255, beadLight.g - 12),
    b: Math.min(255, beadLight.b - 12),
  };
  const dark = {
    r: Math.min(255, beadDark.r + 18),
    g: Math.min(255, beadDark.g + 18),
    b: Math.min(255, beadDark.b + 18),
  };
  const gradient = context.createLinearGradient(x, y, x + cellPixels, y + cellPixels);
  gradient.addColorStop(0, colorString(light, 0.94));
  gradient.addColorStop(0.48, hex);
  gradient.addColorStop(1, colorString(dark, 0.94));
  context.fillStyle = gradient;
  context.fillRect(x - bleed, y - bleed, cellPixels + bleed * 2, cellPixels + bleed * 2);
  // A tiny seam preserves the bead layout after ironing without bringing back
  // the circular wall or center hole of the un-ironed bead.
  context.strokeStyle = colorString(dark, 0.14);
  context.lineWidth = Math.max(0.2, Math.min(0.75, cellPixels * 0.025));
  context.strokeRect(x + 0.15, y + 0.15, Math.max(0, cellPixels - 0.3), Math.max(0, cellPixels - 0.3));
  if (cellPixels >= 8) {
    context.fillStyle = colorString({ r: 255, g: 255, b: 255 }, 0.08);
    context.beginPath();
    context.ellipse(x + cellPixels * 0.28, y + cellPixels * 0.25, cellPixels * 0.2, cellPixels * 0.075, -0.25, 0, Math.PI * 2);
    context.fill();
  }
}

function drawGridOverlay(
  context: PatternDrawingContext,
  options: DrawPatternOptions,
  left: number,
  top: number,
  right: number,
  bottom: number,
): void {
  const { startRow, startColumn, rows, columns, cellPixels, fullGrid, visualMode, showCoordinates, includeAxes } = options;
  const isGrid = visualMode === 'grid';
  context.save();
  context.strokeStyle = isGrid ? '#D1D5DB' : 'rgba(71, 85, 105, 0.18)';
  context.lineWidth = isGrid ? 1 : Math.max(0.5, Math.min(1, cellPixels * 0.03));
  context.beginPath();
  for (let column = 0; column <= columns; column += 1) {
    const x = left + column * cellPixels + (isGrid ? 0.5 : 0);
    context.moveTo(x, top);
    context.lineTo(x, bottom);
  }
  for (let row = 0; row <= rows; row += 1) {
    const y = top + row * cellPixels + (isGrid ? 0.5 : 0);
    context.moveTo(left, y);
    context.lineTo(right, y);
  }
  context.stroke();

  if (isGrid) {
    context.strokeStyle = '#DC2626';
    context.lineWidth = 2;
    context.beginPath();
    for (let localColumn = 0; localColumn <= columns; localColumn += 1) {
      const globalBoundary = startColumn + localColumn;
      if (globalBoundary > 0 && globalBoundary < fullGrid.columns && globalBoundary % 10 === 0) {
        const x = left + localColumn * cellPixels;
        context.moveTo(x, top);
        context.lineTo(x, bottom);
      }
    }
    for (let localRow = 0; localRow <= rows; localRow += 1) {
      const globalBoundary = startRow + localRow;
      if (globalBoundary > 0 && globalBoundary < fullGrid.rows && globalBoundary % 10 === 0) {
        const y = top + localRow * cellPixels;
        context.moveTo(left, y);
        context.lineTo(right, y);
      }
    }
    context.stroke();
  }
  context.restore();

  if (!isGrid || showCoordinates === false || !includeAxes) return;
  context.save();
  context.fillStyle = '#111827';
  context.font = `600 ${Math.max(5, Math.min(13, cellPixels * 0.38))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (let localColumn = 0; localColumn < columns; localColumn += 1) {
    const number = startColumn + localColumn + 1;
    const x = left + localColumn * cellPixels + cellPixels / 2;
    context.fillText(String(number), x, top - Math.max(9, cellPixels * 0.8));
    context.fillText(String(number), x, bottom + Math.max(9, cellPixels * 0.8));
  }
  context.textAlign = 'right';
  for (let localRow = 0; localRow < rows; localRow += 1) {
    const number = startRow + localRow + 1;
    const y = top + localRow * cellPixels + cellPixels / 2;
    context.fillText(String(number), left - Math.max(9, cellPixels * 0.8), y);
    context.textAlign = 'left';
    context.fillText(String(number), right + Math.max(9, cellPixels * 0.8), y);
    context.textAlign = 'right';
  }
  context.restore();
}

export function drawPatternVisual(context: PatternDrawingContext, options: DrawPatternOptions): void {
  const { cells, fullGrid, palette, startRow, startColumn, rows, columns, cellPixels, visualMode, showGridOverlay, watermarkEnabled, includeAxes, preserveEmptyBackground = false } = options;
  const hasAxes = visualMode === 'grid' && includeAxes === true;
  const left = hasAxes ? Math.max(36, cellPixels * 2) : 0;
  const top = hasAxes ? Math.max(36, cellPixels * 2) : 0;
  const right = left + columns * cellPixels;
  const bottom = top + rows * cellPixels;
  context.imageSmoothingEnabled = visualMode !== 'grid';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  if (!preserveEmptyBackground) {
    context.fillStyle = visualMode === 'grid' ? '#FFFFFF' : visualMode === 'beads' ? BEAD_BOARD_COLOR : '#E8E3DA';
    context.fillRect(0, 0, hasAxes ? right + left : right, hasAxes ? bottom + top : bottom);
  }

  for (let localRow = 0; localRow < rows; localRow += 1) {
    const globalRow = startRow + localRow;
    for (let localColumn = 0; localColumn < columns; localColumn += 1) {
      const globalColumn = startColumn + localColumn;
      const value = cells[globalRow * fullGrid.columns + globalColumn] ?? EMPTY_CELL;
      const x = left + localColumn * cellPixels;
      const y = top + localRow * cellPixels;
      if (value === EMPTY_CELL) {
        if (visualMode === 'grid' && !preserveEmptyBackground) drawEmptyCell(context, x, y, cellPixels);
        continue;
      }
      const color = palette.colors[value];
      if (!color) continue;
      if (visualMode === 'grid') drawFlatCell(context, x, y, cellPixels, color, true);
      else if (visualMode === 'beads') drawBead(context, x, y, cellPixels, color.srgbHex);
      else drawIronedCell(context, x, y, cellPixels, color.srgbHex);
    }
  }

  if (watermarkEnabled) {
    drawWatermark(context, { left, top, right, bottom, cellPixels });
  }
  if (visualMode === 'grid' || showGridOverlay) {
    drawGridOverlay(context, options, left, top, right, bottom);
  }
  if (visualMode === 'grid') {
    context.strokeStyle = '#111827';
    context.lineWidth = 2;
    context.strokeRect(left, top, columns * cellPixels, rows * cellPixels);
  }
}

export function drawPatternGrid(context: OffscreenCanvasRenderingContext2D, options: Omit<DrawPatternOptions, 'visualMode' | 'showGridOverlay'>): void {
  drawPatternVisual(context, { ...options, visualMode: 'grid', showGridOverlay: true, includeAxes: true, showCoordinates: true });
}
