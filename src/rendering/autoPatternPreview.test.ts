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

  it('renders solid palette squares over white without smoothing or annotations', async () => {
    const fills: Array<{ color: string; x: number; y: number; width: number; height: number }> = [];
    const context = {
      imageSmoothingEnabled: true,
      fillStyle: '',
      fillRect: (x: number, y: number, width: number, height: number) => {
        fills.push({ color: context.fillStyle, x, y, width, height });
      },
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
    expect(context.imageSmoothingEnabled).toBe(false);
    expect(fills).toEqual([
      { color: '#FFFFFF', x: 0, y: 0, width: 1040, height: 1040 },
      { color: MARD_STANDARD_221_PALETTE.colors[0]?.srgbHex, x: 0, y: 0, width: 520, height: 520 },
      { color: MARD_STANDARD_221_PALETTE.colors[1]?.srgbHex, x: 520, y: 520, width: 520, height: 520 },
    ]);
    expect(preview.type).toBe('image/png');
  });
});
