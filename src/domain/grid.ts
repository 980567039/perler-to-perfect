import { EMPTY_CELL, type ColorCount, type GridSize, type PaletteManifest } from './types';

export function validateGridSize(grid: GridSize): void {
  for (const [label, value] of [
    ['列数', grid.columns],
    ['行数', grid.rows],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 300) {
      throw new Error(`${label}必须是 1–300 的整数。`);
    }
  }
}

export function assertCellBuffer(cells: Uint16Array, grid: GridSize, paletteSize: number): void {
  validateGridSize(grid);
  if (cells.length !== grid.columns * grid.rows) {
    throw new Error('网格数据长度与行列数不一致。');
  }
  for (const value of cells) {
    if (value !== EMPTY_CELL && value >= paletteSize) {
      throw new Error(`网格包含无效色板索引：${value}`);
    }
  }
}

export function countCells(
  cells: Uint16Array,
  grid: GridSize,
  palette: PaletteManifest,
): { counts: ColorCount[]; totalBeads: number } {
  assertCellBuffer(cells, grid, palette.colors.length);
  const totals = new Uint32Array(palette.colors.length);
  let totalBeads = 0;
  for (const value of cells) {
    if (value === EMPTY_CELL) continue;
    totals[value] = (totals[value] ?? 0) + 1;
    totalBeads += 1;
  }

  const counts: ColorCount[] = [];
  totals.forEach((count, paletteIndex) => {
    if (count === 0) return;
    const color = palette.colors[paletteIndex];
    if (!color) return;
    counts.push({ colorId: color.id, paletteIndex, count });
  });

  return { counts, totalBeads };
}

export function encodeCellsRle(cells: Uint16Array): Array<[number, number]> {
  if (cells.length === 0) return [];
  const runs: Array<[number, number]> = [];
  let current = cells[0] ?? EMPTY_CELL;
  let length = 1;
  for (let index = 1; index < cells.length; index += 1) {
    const value = cells[index] ?? EMPTY_CELL;
    if (value === current) {
      length += 1;
    } else {
      runs.push([current, length]);
      current = value;
      length = 1;
    }
  }
  runs.push([current, length]);
  return runs;
}

export function decodeCellsRle(runs: Array<[number, number]>, expectedLength: number): Uint16Array {
  const cells = new Uint16Array(expectedLength);
  let offset = 0;
  for (const [value, runLength] of runs) {
    if (!Number.isInteger(value) || value < 0 || value > EMPTY_CELL) {
      throw new Error('工程文件包含非法格子值。');
    }
    if (!Number.isInteger(runLength) || runLength < 1 || offset + runLength > expectedLength) {
      throw new Error('工程文件包含非法 RLE 长度。');
    }
    cells.fill(value, offset, offset + runLength);
    offset += runLength;
  }
  if (offset !== expectedLength) {
    throw new Error('工程文件的 RLE 长度与网格尺寸不一致。');
  }
  return cells;
}

export function detectBorderBackground(cells: Uint16Array, grid: GridSize): number[] {
  const { columns, rows } = grid;
  const borderCounts = new Map<number, number>();
  const count = (row: number, column: number) => {
    const value = cells[row * columns + column];
    if (value === undefined || value === EMPTY_CELL) return;
    borderCounts.set(value, (borderCounts.get(value) ?? 0) + 1);
  };

  for (let column = 0; column < columns; column += 1) {
    count(0, column);
    if (rows > 1) count(rows - 1, column);
  }
  for (let row = 1; row < rows - 1; row += 1) {
    count(row, 0);
    if (columns > 1) count(row, columns - 1);
  }

  let target = EMPTY_CELL;
  let targetCount = -1;
  for (const [value, valueCount] of borderCounts) {
    if (valueCount > targetCount || (valueCount === targetCount && value < target)) {
      target = value;
      targetCount = valueCount;
    }
  }
  if (target === EMPTY_CELL) return [];

  const visited = new Uint8Array(cells.length);
  const stack: number[] = [];
  const push = (row: number, column: number) => {
    if (row < 0 || row >= rows || column < 0 || column >= columns) return;
    const index = row * columns + column;
    if (visited[index] === 1 || cells[index] !== target) return;
    visited[index] = 1;
    stack.push(index);
  };

  for (let column = 0; column < columns; column += 1) {
    push(0, column);
    push(rows - 1, column);
  }
  for (let row = 1; row < rows - 1; row += 1) {
    push(row, 0);
    push(row, columns - 1);
  }

  const result: number[] = [];
  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined) break;
    result.push(index);
    const row = Math.floor(index / columns);
    const column = index % columns;
    push(row - 1, column);
    push(row + 1, column);
    push(row, column - 1);
    push(row, column + 1);
  }
  return result.sort((a, b) => a - b);
}

function connectedRegion(
  cells: Uint16Array,
  grid: GridSize,
  startIndex: number,
  matches: (value: number, startValue: number) => boolean,
): number[] {
  if (startIndex < 0 || startIndex >= cells.length) return [];
  const startValue = cells[startIndex];
  if (startValue === undefined || startValue === EMPTY_CELL) return [];

  const { columns, rows } = grid;
  const visited = new Uint8Array(cells.length);
  const stack = [startIndex];
  const result: number[] = [];
  visited[startIndex] = 1;

  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined) break;
    const value = cells[index];
    if (value === undefined || !matches(value, startValue)) continue;
    result.push(index);
    const row = Math.floor(index / columns);
    const column = index % columns;
    for (const [rowOffset, columnOffset] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nextRow = row + rowOffset;
      const nextColumn = column + columnOffset;
      if (nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= columns) continue;
      const next = nextRow * columns + nextColumn;
      if (visited[next] === 1) continue;
      visited[next] = 1;
      if (cells[next] !== EMPTY_CELL) stack.push(next);
    }
  }
  return result.sort((a, b) => a - b);
}

/** Returns the contiguous region of the exact same palette color as the clicked cell. */
export function findMagicWandRegion(cells: Uint16Array, grid: GridSize, startIndex: number): number[] {
  return connectedRegion(cells, grid, startIndex, (value, startValue) => value === startValue);
}

/** Returns the largest contiguous non-empty component, regardless of palette color. */
export function findLargestNonEmptyRegion(cells: Uint16Array, grid: GridSize): number[] {
  let largest: number[] = [];
  const visited = new Uint8Array(cells.length);
  for (let index = 0; index < cells.length; index += 1) {
    if (visited[index] === 1 || cells[index] === EMPTY_CELL) continue;
    const region = connectedRegion(cells, grid, index, (value) => value !== EMPTY_CELL);
    region.forEach((regionIndex) => (visited[regionIndex] = 1));
    if (region.length > largest.length) largest = region;
  }
  return largest;
}
