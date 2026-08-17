import { deltaE2000 } from './color';
import { EMPTY_CELL, type CellReason, type GridSize, type LabColor, type PatternDiagnostics } from './types';

export interface StructuralRepresentative {
  lab: LabColor;
  edgeStrength: number;
  detailWeight: number;
  sourceEdgeStrength?: number;
}

const NEIGHBORS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * A conservative grid-level regularizer. It only removes a single-cell
 * disagreement when the original cell has weak source-edge evidence and the
 * surrounding region explains its colour almost as well. This is deliberately
 * different from frequency cleanup: rare, high-contrast features stay intact.
 */
export function regularizeStructure(
  cells: Uint16Array,
  grid: GridSize,
  paletteLabs: LabColor[],
  representatives: Array<StructuralRepresentative | null>,
  strength: number,
): { cells: Uint16Array; changed: Uint8Array } {
  const normalizedStrength = Math.max(0, Math.min(1, strength));
  if (normalizedStrength <= 0) return { cells, changed: new Uint8Array(cells.length) };
  const { columns, rows } = grid;
  const changed = new Uint8Array(cells.length);
  let output = cells.slice();
  const passes = normalizedStrength >= 0.72 ? 2 : 1;

  for (let pass = 0; pass < passes; pass += 1) {
    const input = output;
    const next = input.slice();
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index];
      const representative = representatives[index];
      if (current === undefined || current === EMPTY_CELL || !representative) continue;
      // Strong source contrast is a likely contour or intentional small detail.
      // A modest tone step can still be an anti-aliased texture.  Preserve
      // genuinely strong contours, but allow low-contrast accents to be
      // regularized even when their neighbouring cells are uniform.
      if (representative.edgeStrength >= 14 || (representative.sourceEdgeStrength ?? 0) >= 28) continue;
      const row = Math.floor(index / columns);
      const column = index % columns;
      const neighborCounts = new Map<number, number>();
      let neighborTotal = 0;
      for (const [rowOffset, columnOffset] of NEIGHBORS) {
        const targetRow = row + rowOffset;
        const targetColumn = column + columnOffset;
        if (targetRow < 0 || targetRow >= rows || targetColumn < 0 || targetColumn >= columns) continue;
        const value = input[targetRow * columns + targetColumn];
        if (value === undefined || value === EMPTY_CELL || value === current) continue;
        neighborTotal += 1;
        neighborCounts.set(value, (neighborCounts.get(value) ?? 0) + 1);
      }
      if (neighborTotal < 3) continue;
      let replacement = EMPTY_CELL;
      let replacementCount = 0;
      for (const [candidate, count] of neighborCounts) {
        if (count > replacementCount || (count === replacementCount && candidate < replacement)) {
          replacement = candidate;
          replacementCount = count;
        }
      }
      if (replacement === EMPTY_CELL || replacementCount < 3) continue;
      const currentLab = paletteLabs[current];
      const replacementLab = paletteLabs[replacement];
      if (!currentLab || !replacementLab) continue;
      const currentError = deltaE2000(representative.lab, currentLab);
      const replacementError = deltaE2000(representative.lab, replacementLab);
      // Cleaner profiles may make a slightly less exact local colour choice;
      // detail profiles stay closer to the original sampled colour.
      const toleratedError = 2 + normalizedStrength * 8;
      if (replacementError <= currentError + toleratedError) {
        next[index] = replacement;
        changed[index] = 1;
      }
    }
    output = next;
  }
  return { cells: output, changed };
}

export function buildPatternDiagnostics(
  cells: Uint16Array,
  grid: GridSize,
  paletteLabs: LabColor[],
  selectedPaletteIndices: number[],
  representatives: Array<StructuralRepresentative | null>,
  changed: Uint8Array,
): PatternDiagnostics {
  const confidence = new Uint8Array(cells.length);
  const reasons: CellReason[] = new Array(cells.length).fill('flat');
  let nonEmpty = 0;
  let noisy = 0;
  let sourceEdges = 0;
  let preservedBoundaries = 0;
  const { columns, rows } = grid;

  for (let index = 0; index < cells.length; index += 1) {
    const value = cells[index];
    const representative = representatives[index];
    if (value === undefined || value === EMPTY_CELL || !representative) continue;
    nonEmpty += 1;
    let best = Number.POSITIVE_INFINITY;
    let second = Number.POSITIVE_INFINITY;
    for (const paletteIndex of selectedPaletteIndices) {
      const lab = paletteLabs[paletteIndex];
      if (!lab) continue;
      const distance = deltaE2000(representative.lab, lab);
      if (distance < best) {
        second = best;
        best = distance;
      } else if (distance < second) second = distance;
    }
    confidence[index] = clampByte(28 + Math.max(0, second - best) * 15 - best * 2);
    if (changed[index] === 1) {
      reasons[index] = 'noise';
      noisy += 1;
    } else if (representative.edgeStrength >= 12 || (representative.sourceEdgeStrength ?? 0) >= 28) {
      reasons[index] = 'edge';
    } else if (representative.detailWeight > 1.5) {
      reasons[index] = 'detail';
    }
    const row = Math.floor(index / columns);
    const column = index % columns;
    for (const [rowOffset, columnOffset] of [[1, 0], [0, 1]] as const) {
      const nextRow = row + rowOffset;
      const nextColumn = column + columnOffset;
      if (nextRow >= rows || nextColumn >= columns) continue;
      const nextIndex = nextRow * columns + nextColumn;
      const nextRepresentative = representatives[nextIndex];
      if (!nextRepresentative || nextRepresentative.edgeStrength < 9) continue;
      sourceEdges += 1;
      if (cells[nextIndex] !== value) preservedBoundaries += 1;
    }
  }
  return {
    confidence,
    reasons,
    structureScore: sourceEdges ? preservedBoundaries / sourceEdges : 1,
    noiseScore: nonEmpty ? noisy / nonEmpty : 0,
  };
}
