import { afterEach, describe, expect, it, vi } from 'vitest';
import { MARD_STANDARD_221_PALETTE } from '../domain/mardPalette';
import { EMPTY_CELL } from '../domain/types';
import { autoPatternPreviewDimensions, renderAutoPatternPreview } from './autoPatternPreview';

describe('automatic clean pattern preview', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses integer cell pixels with an approximately 1040px longest side', () => {
    expect(autoPatternPreviewDimensions({ columns: 104, rows: 104 })).toEqual({
      cellPixels: 10,
      width: 1040,
      height: 1040,
    });
    expect(autoPatternPreviewDimensions({ columns: 80, rows: 120 })).toEqual({
      cellPixels: 8,
      width: 640,
      height: 960,
    });
    expect(autoPatternPreviewDimensions({ columns: 300, rows: 200 })).toEqual({
      cellPixels: 3,
      width: 900,
      height: 600,
    });
  });

  it('renders the default cylindrical bead preview without a grid overlay', async () => {
    const arcs: number[][] = [];
    const fills: Array<{ color: string; x: number; y: number; width: number; height: number }> = [];
    const gradient = { addColorStop: () => undefined } as CanvasGradient;
    const context = {
      imageSmoothingEnabled: true,
      fillStyle: '',
      fillRect: (x: number, y: number, width: number, height: number) => {
        fills.push({ color: context.fillStyle, x, y, width, height });
      },
      strokeStyle: '',
      lineWidth: 1,
      textAlign: 'start',
      textBaseline: 'alphabetic',
      font: '',
      save: () => undefined,
      restore: () => undefined,
      beginPath: () => undefined,
      arc: (...args: number[]) => arcs.push(args),
      fill: () => undefined,
      stroke: () => undefined,
      ellipse: () => undefined,
      createRadialGradient: () => gradient,
      createLinearGradient: () => gradient,
      fillText: () => undefined,
      measureText: () => ({ width: 1 }),
      rect: () => undefined,
      clip: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      strokeRect: () => undefined,
    };
    let canvasSize: { width: number; height: number } | null = null;
    class FakeOffscreenCanvas {
      constructor(width: number, height: number) {
        canvasSize = { width, height };
      }

      getContext() {
        return context;
      }

      async convertToBlob() {
        return new Blob(['preview'], { type: 'image/png' });
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const cells = new Uint16Array([0, EMPTY_CELL, EMPTY_CELL, 1]);

    const preview = await renderAutoPatternPreview({
      grid: { columns: 2, rows: 2 },
      cells,
      palette: MARD_STANDARD_221_PALETTE,
    });

    expect(canvasSize).toEqual({ width: 1040, height: 1040 });
    expect(context.imageSmoothingEnabled).toBe(true);
    expect(fills).toEqual([{ color: '#E8E3DA', x: 0, y: 0, width: 1040, height: 1040 }]);
    // Two occupied cells each receive a shadow, body, hole and highlight arc.
    expect(arcs).toHaveLength(8);
    expect(preview.type).toBe('image/png');
  });
});
