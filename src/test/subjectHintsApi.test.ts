import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/subject-hints';

interface TestResponse {
  statusCode?: number;
  payload?: unknown;
  status(code: number): TestResponse;
  json(payload: unknown): void;
}

function createResponse(): TestResponse {
  const result = {} as TestResponse;
  result.status = vi.fn((statusCode: number) => {
    result.statusCode = statusCode;
    return result;
  });
  result.json = vi.fn((payload: unknown) => {
    result.payload = payload;
  });
  return result;
}

const request = {
  method: 'POST',
  body: { image: 'data:image/png;base64,AAECAw==', mimeType: 'image/png' },
};

const hints = {
  bbox: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
  foregroundSeeds: [{ x: 0.5, y: 0.5, kind: 'inside' as const }],
  focusRegions: [{ x: 0.5, y: 0.35, radius: 0.08, kind: 'face' as const, confidence: 0.9 }],
  confidence: 0.95,
};

describe('subject hints Vercel function', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('is closed by default and does not call OpenAI without the opt-in configuration', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = createResponse();

    await handler(request, response);

    expect(response.statusCode).toBe(503);
    expect(response.payload).toEqual(expect.objectContaining({
      ok: false,
      code: 'SUBJECT_HINTS_DISABLED',
    }));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('validates the request before sending the image upstream', async () => {
    vi.stubEnv('SUBJECT_HINTS_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = createResponse();

    await handler({ method: 'POST', body: { image: 'https://example.com/image.png', mimeType: 'image/png' } }, response);

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual(expect.objectContaining({ ok: false, code: 'INVALID_REQUEST' }));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends a non-persistent structured vision request and validates the response', async () => {
    vi.stubEnv('SUBJECT_HINTS_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('OPENAI_VISION_MODEL', 'test-vision-model');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify(hints),
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const response = createResponse();

    await handler(request, response);

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual({ ok: true, hints });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init.headers).toEqual({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(init.body)) as {
      model: string;
      store: boolean;
      input: Array<{ content: Array<{ type: string; image_url?: string }> }>;
      text: { format: { type: string; name: string; strict: boolean; schema: unknown } };
    };
    expect(body.model).toBe('test-vision-model');
    expect(body.store).toBe(false);
    expect(body.text.format).toEqual(expect.objectContaining({
      type: 'json_schema',
      name: 'subject_hints',
      strict: true,
    }));
    expect(body.input[1]?.content).toContainEqual(expect.objectContaining({
      type: 'input_image',
      image_url: request.body.image,
    }));
  });

  it('does not expose malformed upstream output', async () => {
    vi.stubEnv('SUBJECT_HINTS_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: '{"bbox":{}}',
    }), { status: 200 })));
    const response = createResponse();

    await handler(request, response);

    expect(response.statusCode).toBe(502);
    expect(response.payload).toEqual(expect.objectContaining({
      ok: false,
      code: 'INVALID_MODEL_OUTPUT',
    }));
    expect(JSON.stringify(response.payload)).not.toContain(request.body.image);
  });
});
