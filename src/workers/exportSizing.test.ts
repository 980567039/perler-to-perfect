import { describe, expect, it } from 'vitest';
import {
  MAX_GRID_CANVAS_PIXELS,
  MAX_VISUAL_CANVAS_PIXELS,
  chooseGridCellPixels,
  chooseVisualCellPixels,
} from './exportSizing';
import { gridCanvasDimensions, visualCanvasDimensions } from '../rendering/patternDrawing';

describe('export canvas sizing', () => {
  it('keeps a 300 × 300 grid within the decoded canvas budget', () => {
    const cellPixels = chooseGridCellPixels(300, 300);
    const dimensions = gridCanvasDimensions(300, 300, cellPixels);
    expect(cellPixels).toBe(18);
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(MAX_GRID_CANVAS_PIXELS);
  });

  it('keeps visual exports within a lower budget than the production grid', () => {
    const cellPixels = chooseVisualCellPixels(300, 300);
    const dimensions = visualCanvasDimensions(300, 300, cellPixels);
    expect(cellPixels).toBe(16);
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(MAX_VISUAL_CANVAS_PIXELS);
    expect(cellPixels).toBeLessThanOrEqual(chooseGridCellPixels(300, 300));
  });

  it('retains the high-resolution default for common 104 × 104 boards', () => {
    expect(chooseGridCellPixels(104, 104)).toBe(24);
    expect(chooseVisualCellPixels(104, 104)).toBe(24);
  });
});
