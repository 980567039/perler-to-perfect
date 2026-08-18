import {
  isSubjectHints,
  isSubjectHintsImageMimeType,
  MAX_SUBJECT_HINTS_IMAGE_BYTES,
  type SubjectHints,
  type SubjectHintsApiResponse,
  type SubjectHintsRequestBody,
} from '../src/integrations/subjectHints.types.js';

interface SubjectHintsApiRequest {
  method?: string;
  body?: unknown;
}

interface SubjectHintsApiResponseWriter {
  status(code: number): SubjectHintsApiResponseWriter;
  json(payload: SubjectHintsApiResponse): void;
  setHeader?(name: string, value: string): void;
}

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_VISION_MODEL = 'gpt-5.6';
const OPENAI_TIMEOUT_MS = 15_000;
const MAX_DATA_URL_LENGTH = Math.ceil(MAX_SUBJECT_HINTS_IMAGE_BYTES / 3) * 4 + 64;

const SUBJECT_HINTS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    bbox: {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
    foregroundSeeds: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          kind: { type: 'string', enum: ['inside', 'outside'] },
        },
        required: ['x', 'y', 'kind'],
      },
    },
    focusRegions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          radius: { type: 'number' },
          kind: { type: 'string', enum: ['face', 'eye', 'outline', 'accessory'] },
          confidence: { type: 'number' },
        },
        required: ['x', 'y', 'radius', 'kind', 'confidence'],
      },
    },
    confidence: { type: 'number' },
  },
  required: ['bbox', 'foregroundSeeds', 'focusRegions', 'confidence'],
} as const;

const SYSTEM_PROMPT = [
  'Analyze the supplied cropped image for a bead pattern generator.',
  'Return only the requested structured subject hints; do not describe the image and do not redraw it.',
  'Coordinates are normalized from 0 to 1 relative to the supplied image.',
  'bbox is the smallest useful subject box. Use inside seeds for definite subject pixels and outside seeds for definite background pixels.',
  'focusRegions should mark visually important details such as a face, eyes, strong outline, or accessory that a low-resolution grid should preserve.',
  'radius is normalized against the longest image dimension. Use a confidence from 0 to 1.',
  'If the subject is ambiguous, return conservative hints with a lower overall confidence.',
].join(' ');

function send(
  response: SubjectHintsApiResponseWriter,
  status: number,
  payload: SubjectHintsApiResponse,
): void {
  response.setHeader?.('Cache-Control', 'no-store');
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  response.status(status).json(payload);
}

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function isRequestBody(value: unknown): value is SubjectHintsRequestBody {
  if (!value || typeof value !== 'object') return false;
  const body = value as Partial<SubjectHintsRequestBody>;
  return (
    typeof body.image === 'string' &&
    typeof body.mimeType === 'string' &&
    isSubjectHintsImageMimeType(body.mimeType)
  );
}

function dataUrlByteLength(dataUrl: string, mimeType: string): number | null {
  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix) || dataUrl.length > MAX_DATA_URL_LENGTH) return null;
  const encoded = dataUrl.slice(prefix.length);
  if (encoded.length === 0 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return null;
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const byteLength = (encoded.length / 4) * 3 - padding;
  return byteLength >= 1 && byteLength <= MAX_SUBJECT_HINTS_IMAGE_BYTES ? byteLength : null;
}

function configuredModel(): string {
  const configured = process.env.OPENAI_VISION_MODEL?.trim();
  return configured && /^[A-Za-z0-9._:-]{1,100}$/.test(configured)
    ? configured
    : DEFAULT_VISION_MODEL;
}

function extractOutputText(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as { output_text?: unknown; output?: unknown };
  if (typeof response.output_text === 'string' && response.output_text.length > 0) {
    return response.output_text;
  }
  if (!Array.isArray(response.output)) return null;
  for (const item of response.output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string' && text.length > 0) return text;
    }
  }
  return null;
}

function parseSubjectHints(value: string): SubjectHints | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isSubjectHints(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export default async function handler(
  request: SubjectHintsApiRequest,
  response: SubjectHintsApiResponseWriter,
): Promise<void> {
  if (request.method !== 'POST') {
    send(response, 405, {
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
      message: '仅支持 POST 请求。',
    });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (process.env.SUBJECT_HINTS_ENABLED !== 'true' || !apiKey) {
    send(response, 503, {
      ok: false,
      code: 'SUBJECT_HINTS_DISABLED',
      message: '主体增强接口未启用。',
    });
    return;
  }

  const body = parseBody(request.body);
  if (!isRequestBody(body) || dataUrlByteLength(body.image, body.mimeType) === null) {
    send(response, 400, {
      ok: false,
      code: 'INVALID_REQUEST',
      message: '图片请求无效。',
    });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: configuredModel(),
        store: false,
        max_output_tokens: 1200,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: SYSTEM_PROMPT }] },
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'Find the main subject and the details that should survive bead-grid simplification.' },
              { type: 'input_image', image_url: body.image, detail: 'original' },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'subject_hints',
            strict: true,
            schema: SUBJECT_HINTS_JSON_SCHEMA,
          },
        },
      }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    send(response, 502, {
      ok: false,
      code: 'UPSTREAM_ERROR',
      message: '主体增强服务暂不可用。',
    });
    return;
  }
  clearTimeout(timeout);

  if (!upstream.ok) {
    send(response, 502, {
      ok: false,
      code: 'UPSTREAM_ERROR',
      message: '主体增强服务暂不可用。',
    });
    return;
  }

  let upstreamPayload: unknown;
  try {
    upstreamPayload = await upstream.json();
  } catch {
    send(response, 502, {
      ok: false,
      code: 'INVALID_MODEL_OUTPUT',
      message: '主体增强服务返回了无效结果。',
    });
    return;
  }

  const outputText = extractOutputText(upstreamPayload);
  const hints = outputText ? parseSubjectHints(outputText) : null;
  if (!hints) {
    send(response, 502, {
      ok: false,
      code: 'INVALID_MODEL_OUTPUT',
      message: '主体增强服务返回了无效结果。',
    });
    return;
  }

  send(response, 200, { ok: true, hints });
}
