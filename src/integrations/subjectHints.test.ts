import { describe, expect, it, vi } from 'vitest';
import { parseSubjectHints, requestSubjectHints } from './subjectHints';

const hints = {
  bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
  foregroundSeeds: [
    { x: 0.4, y: 0.5, kind: 'inside' as const },
    { x: 0.02, y: 0.02, kind: 'outside' as const },
  ],
  focusRegions: [{ x: 0.42, y: 0.35, radius: 0.08, kind: 'eye' as const, confidence: 0.9 }],
  confidence: 0.88,
};

describe('subject hint contract', () => {
  it('accepts normalized subject hints', () => {
    expect(parseSubjectHints(hints).bbox.width).toBe(0.5);
  });

  it('rejects coordinates outside the normalized image', () => {
    expect(() => parseSubjectHints({
      ...hints,
      bbox: { x: -0.1, y: 0, width: 0.5, height: 0.5 },
    })).toThrow();
  });
});

describe('subject hints client', () => {
  it('rejects unsupported images before making a request', async () => {
    const fetcher = vi.fn();

    const result = await requestSubjectHints(new Blob(['not an image'], { type: 'image/gif' }), { fetcher });

    expect(result).toEqual({ ok: false, code: 'INVALID_IMAGE' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('encodes the cropped image and accepts structured hints', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, hints }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await requestSubjectHints(
      new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'image/png' }),
      { endpoint: '/custom/subject-hints', fetcher },
    );

    expect(result).toEqual({ ok: true, hints });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/custom/subject-hints');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    const body = JSON.parse(String(init.body)) as { image: string; mimeType: string };
    expect(body.mimeType).toBe('image/png');
    expect(body.image).toBe('data:image/png;base64,AAECAw==');
  });

  it('returns a safe disabled result without throwing in result mode', async () => {
    const result = await requestSubjectHints(
      new Blob(['png'], { type: 'image/png' }),
      {
        fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({
          ok: false,
          code: 'SUBJECT_HINTS_DISABLED',
          message: '主体增强接口未启用。',
        }), { status: 503 })),
      },
    );

    expect(result).toEqual({ ok: false, code: 'SUBJECT_HINTS_DISABLED', status: 503 });
  });

  it('turns network errors into a safe fallback result', async () => {
    const result = await requestSubjectHints(
      new Blob(['png'], { type: 'image/png' }),
      { fetcher: vi.fn().mockRejectedValue(new Error('offline')) },
    );

    expect(result).toEqual({ ok: false, code: 'NETWORK_ERROR' });
  });
});

