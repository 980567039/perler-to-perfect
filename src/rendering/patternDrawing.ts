import { contrastTextColor } from '../domain/color';
import { EMPTY_CELL, type GridSize, type PaletteManifest } from '../domain/types';

export interface DrawGridOptions {
  cells: Uint16Array;
  fullGrid: GridSize;
  palette: PaletteManifest;
  startRow: number;
  startColumn: number;
  rows: number;
  columns: number;
  cellPixels: number;
}

export function gridCanvasDimensions(columns: number, rows: number, cellPixels: number) {
  const axis = Math.max(36, cellPixels * 2);
  return {
    axis,
    width: columns * cellPixels + axis * 2,
    height: rows * cellPixels + axis * 2,
  };
}

function fitCellFont(context: OffscreenCanvasRenderingContext2D, code: string, cellPixels: number): number {
  let size = Math.max(7, Math.floor(cellPixels * 0.4));
  while (size > 6) {
    context.font = `700 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    if (context.measureText(code).width <= cellPixels - 3) break;
    size -= 1;
  }
  return size;
}

export function drawPatternGrid(context: OffscreenCanvasRenderingContext2D, options: DrawGridOptions): void {
  const { cells, fullGrid, palette, startRow, startColumn, rows, columns, cellPixels } = options;
  const { axis, width, height } = gridCanvasDimensions(columns, rows, cellPixels);
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, width, height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  for (let localRow = 0; localRow < rows; localRow += 1) {
    const globalRow = startRow + localRow;
    for (let localColumn = 0; localColumn < columns; localColumn += 1) {
      const globalColumn = startColumn + localColumn;
      const value = cells[globalRow * fullGrid.columns + globalColumn] ?? EMPTY_CELL;
      const x = axis + localColumn * cellPixels;
      const y = axis + localRow * cellPixels;
      if (value === EMPTY_CELL) {
        context.fillStyle = '#FFFFFF';
        context.fillRect(x, y, cellPixels, cellPixels);
        continue;
      }
      const color = palette.colors[value];
      if (!color) continue;
      context.fillStyle = color.srgbHex;
      context.fillRect(x, y, cellPixels, cellPixels);
      context.save();
      context.beginPath();
      context.rect(x + 1, y + 1, cellPixels - 2, cellPixels - 2);
      context.clip();
      const fontSize = fitCellFont(context, color.code, cellPixels);
      context.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      context.fillStyle = contrastTextColor(color.srgbHex);
      context.fillText(color.code, x + cellPixels / 2, y + cellPixels / 2 + 0.25);
      context.restore();
    }
  }

  const gridLeft = axis;
  const gridTop = axis;
  const gridRight = axis + columns * cellPixels;
  const gridBottom = axis + rows * cellPixels;
  context.strokeStyle = '#D1D5DB';
  context.lineWidth = 1;
  context.beginPath();
  for (let column = 0; column <= columns; column += 1) {
    const x = gridLeft + column * cellPixels + 0.5;
    context.moveTo(x, gridTop);
    context.lineTo(x, gridBottom);
  }
  for (let row = 0; row <= rows; row += 1) {
    const y = gridTop + row * cellPixels + 0.5;
    context.moveTo(gridLeft, y);
    context.lineTo(gridRight, y);
  }
  context.stroke();

  context.strokeStyle = '#DC2626';
  context.lineWidth = 2;
  context.beginPath();
  for (let localColumn = 0; localColumn <= columns; localColumn += 1) {
    const globalBoundary = startColumn + localColumn;
    if (globalBoundary > 0 && globalBoundary < fullGrid.columns && globalBoundary % 10 === 0) {
      const x = gridLeft + localColumn * cellPixels;
      context.moveTo(x, gridTop);
      context.lineTo(x, gridBottom);
    }
  }
  for (let localRow = 0; localRow <= rows; localRow += 1) {
    const globalBoundary = startRow + localRow;
    if (globalBoundary > 0 && globalBoundary < fullGrid.rows && globalBoundary % 10 === 0) {
      const y = gridTop + localRow * cellPixels;
      context.moveTo(gridLeft, y);
      context.lineTo(gridRight, y);
    }
  }
  context.stroke();

  context.strokeStyle = '#111827';
  context.lineWidth = 2;
  context.strokeRect(gridLeft, gridTop, columns * cellPixels, rows * cellPixels);
  context.fillStyle = '#111827';
  context.font = '600 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  for (let localColumn = 0; localColumn < columns; localColumn += 1) {
    const number = startColumn + localColumn + 1;
    if (number !== 1 && number !== fullGrid.columns && number % 10 !== 0) continue;
    const x = gridLeft + localColumn * cellPixels + cellPixels / 2;
    context.fillText(String(number), x, axis / 2);
    context.fillText(String(number), x, height - axis / 2);
  }
  for (let localRow = 0; localRow < rows; localRow += 1) {
    const number = startRow + localRow + 1;
    if (number !== 1 && number !== fullGrid.rows && number % 10 !== 0) continue;
    const y = gridTop + localRow * cellPixels + cellPixels / 2;
    context.fillText(String(number), axis / 2, y);
    context.fillText(String(number), width - axis / 2, y);
  }
}
