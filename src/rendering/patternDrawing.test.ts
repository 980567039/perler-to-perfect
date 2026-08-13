import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_PALETTE } from '../domain/devPalette';
import { EMPTY_CELL } from '../domain/types';
import { drawPatternVisual, gridCanvasDimensions, visualCanvasDimensions } from './patternDrawing';

interface Call {
  name: string;
  args: unknown[];
}

function createContext() {
  const calls: Call[] = [];
  const gradient = { addColorStop: () => undefined } as CanvasGradient;
  const context = {
    imageSmoothingEnabled: false,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save: () => calls.push({ name: 'save', args: [] }),
    restore: () => calls.push({ name: 'restore', args: [] }),
    beginPath: () => calls.push({ name: 'beginPath', args: [] }),
    closePath: () => calls.push({ name: 'closePath', args: [] }),
    clip: () => calls.push({ name: 'clip', args: [] }),
    fill: () => calls.push({ name: 'fill', args: [] }),
    stroke: () => calls.push({ name: 'stroke', args: [] }),
    arc: (...args: number[]) => calls.push({ name: 'arc', args }),
    ellipse: (...args: number[]) => calls.push({ name: 'ellipse', args }),
    rect: (...args: number[]) => calls.push({ name: 'rect', args }),
    fillRect: (...args: number[]) => calls.push({ name: 'fillRect', args }),
    strokeRect: (...args: number[]) => calls.push({ name: 'strokeRect', args }),
    moveTo: (...args: number[]) => calls.push({ name: 'moveTo', args }),
    lineTo: (...args: number[]) => calls.push({ name: 'lineTo', args }),
    fillText: (...args: unknown[]) => calls.push({ name: 'fillText', args }),
    measureText: () => ({ width: 1 }),
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
  };
  return { calls, context: context as unknown as CanvasRenderingContext2D };
}

const base = {
  cells: new Uint16Array([0, EMPTY_CELL, 1, 2]),
  fullGrid: { columns: 2, rows: 2 },
  palette: DEVELOPMENT_PALETTE,
  startRow: 0,
  startColumn: 0,
  rows: 2,
  columns: 2,
  cellPixels: 20,
  showGridOverlay: false,
  watermarkEnabled: false,
} as const;

describe('pattern visual drawing', () => {
  it('uses axis margins only for a production grid drawing', () => {
    expect(visualCanvasDimensions(2, 3, 20)).toEqual({ width: 40, height: 60 });
    expect(gridCanvasDimensions(2, 3, 20)).toEqual({ axis: 40, width: 120, height: 140 });
  });

  it('renders cylindrical beads with circular bodies and a center hole', () => {
    const { context, calls } = createContext();
    drawPatternVisual(context, { ...base, visualMode: 'beads' });
    // Three occupied cells × (shadow, body, hole, hole highlight arc).
    expect(calls.filter((call) => call.name === 'arc')).toHaveLength(12);
    expect(calls.some((call) => call.name === 'fillRect' && call.args.includes(20))).toBe(false);
  });

  it('renders ironed beads without circular holes', () => {
    const { context, calls } = createContext();
    drawPatternVisual(context, { ...base, visualMode: 'ironed' });
    expect(calls.filter((call) => call.name === 'arc')).toHaveLength(0);
    expect(calls.filter((call) => call.name === 'fillRect')).toHaveLength(4);
  });

  it('always renders grid lines and color codes in the production grid mode', () => {
    const { context, calls } = createContext();
    drawPatternVisual(context, { ...base, visualMode: 'grid', includeAxes: true, showCoordinates: true });
    expect(calls.some((call) => call.name === 'fillText' && call.args[0] === 'D01')).toBe(true);
    expect(calls.some((call) => call.name === 'fillText' && call.args[0] === '1')).toBe(true);
    expect(calls.filter((call) => call.name === 'lineTo').length).toBeGreaterThan(0);
  });
});
