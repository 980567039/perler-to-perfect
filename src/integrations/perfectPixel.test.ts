import { describe, expect, it, vi } from 'vitest';
import { requestPerfectPixel } from './perfectPixel';

describe('Perfect Pixel client contract', () => {
  it('sends the current grid dimensions to the Python service', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      engine: 'perfect-pixel',
      version: '0.1.4',
      width: 104,
      height: 104,
      image: 'data:image/png;base64,AA==',
      alpha: 'AA==',
      settings: {
        sampleMethod: 'majority',
        gridSize: [104, 104],
        refineIntensity: 0.25,
        fixSquare: false,
      },
    }), { status: 200 }));

    const result = await requestPerfectPixel(
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      { columns: 104, rows: 104 },
      { fetcher },
    );

    expect(result.engine).toBe('perfect-pixel');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      gridSize: [number, number];
      sampleMethod: string;
      refineIntensity: number;
      fixSquare: boolean;
    };
    expect(body.gridSize).toEqual([104, 104]);
    expect(body.sampleMethod).toBe('majority');
    expect(body.refineIntensity).toBe(0.25);
    expect(body.fixSquare).toBe(false);
  });

  it('surfaces a structured service failure for the caller to fall back', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      code: 'missing-dependency',
      error: 'Perfect Pixel 服务缺少 Python 依赖。',
    }), { status: 503 }));

    await expect(requestPerfectPixel(
      new Blob([new Uint8Array([1])], { type: 'image/png' }),
      { columns: 104, rows: 104 },
      { fetcher },
    )).rejects.toThrow('Perfect Pixel 服务缺少 Python 依赖。');
  });
});
