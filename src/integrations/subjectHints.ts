import {
  isSubjectHints,
  isSubjectHintsImageMimeType,
  MAX_SUBJECT_HINTS_IMAGE_BYTES,
  SUBJECT_HINTS_ENDPOINT,
  type SubjectHints,
  type SubjectHintsApiFailureCode,
  type SubjectHintsClientResult,
  type SubjectHintsImageMimeType,
  type SubjectHintsRequestBody,
} from './subjectHints.types';
import { fitWithinFrame } from '../domain/framing';

export interface SubjectHintImageSettings {
  grid: { columns: number; rows: number };
  fit: 'contain' | 'crop';
  transform: { scale: number; offsetX: number; offsetY: number };
  cropBox?: { x: number; y: number; width: number; height: number };
}

export interface RequestSubjectHintsOptions {
  endpoint?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}

export function parseSubjectHints(value: unknown): SubjectHints {
  if (!isSubjectHints(value)) throw new Error('主体增强服务返回了无效响应。');
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function readBlobAsArrayBuffer(image: Blob): Promise<ArrayBuffer> {
  if (typeof image.arrayBuffer === 'function') return image.arrayBuffer();
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        if (reader.result instanceof ArrayBuffer) resolve(reader.result);
        else reject(new Error('无法读取图片。'));
      });
      reader.addEventListener('error', () => reject(reader.error ?? new Error('无法读取图片。')));
      reader.readAsArrayBuffer(image);
    });
  }
  return new Response(image).arrayBuffer();
}

async function imageToDataUrl(image: Blob, mimeType: SubjectHintsImageMimeType): Promise<string> {
  const bytes = new Uint8Array(await readBlobAsArrayBuffer(image));
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

function isApiFailureCode(value: unknown): value is SubjectHintsApiFailureCode {
  return (
    value === 'SUBJECT_HINTS_DISABLED' ||
    value === 'INVALID_REQUEST' ||
    value === 'METHOD_NOT_ALLOWED' ||
    value === 'PAYLOAD_TOO_LARGE' ||
    value === 'UPSTREAM_ERROR' ||
    value === 'INVALID_MODEL_OUTPUT'
  );
}

async function requestSubjectHintsResult(
  image: Blob,
  options: RequestSubjectHintsOptions = {},
): Promise<SubjectHintsClientResult> {
  if (!isSubjectHintsImageMimeType(image.type) || image.size < 1) {
    return { ok: false, code: 'INVALID_IMAGE' };
  }
  if (image.size > MAX_SUBJECT_HINTS_IMAGE_BYTES) {
    return { ok: false, code: 'PAYLOAD_TOO_LARGE' };
  }

  const mimeType = image.type;
  let body: SubjectHintsRequestBody;
  try {
    body = {
      image: await imageToDataUrl(image, mimeType),
      mimeType,
    };
  } catch {
    return { ok: false, code: 'INVALID_IMAGE' };
  }
  const fetcher = options.fetcher ?? fetch;

  let response: Response;
  try {
    response = await fetcher(options.endpoint ?? SUBJECT_HINTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch {
    return { ok: false, code: 'NETWORK_ERROR' };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, code: 'INVALID_RESPONSE', status: response.status };
  }

  if (!response.ok) {
    const code = isApiFailureCode((payload as { code?: unknown })?.code)
      ? (payload as { code: SubjectHintsApiFailureCode }).code
      : 'INVALID_RESPONSE';
    return { ok: false, code, status: response.status };
  }

  const hints = payload && typeof payload === 'object'
    ? (payload as { hints?: unknown }).hints
    : undefined;
  if ((payload as { ok?: unknown } | null)?.ok !== true || !isSubjectHints(hints)) {
    return { ok: false, code: 'INVALID_RESPONSE', status: response.status };
  }

  return { ok: true, hints: hints as SubjectHints };
}

export function requestSubjectHints(
  image: Blob,
  options: RequestSubjectHintsOptions,
): Promise<SubjectHintsClientResult>;
export function requestSubjectHints(image: Blob): Promise<SubjectHints>;
export async function requestSubjectHints(
  image: Blob,
  options?: RequestSubjectHintsOptions,
): Promise<SubjectHints | SubjectHintsClientResult> {
  const result = await requestSubjectHintsResult(image, options);
  if (options) return result;
  if (result.ok) return result.hints;
  throw new Error(
    result.code === 'SUBJECT_HINTS_DISABLED'
      ? '主体增强服务未启用。'
      : '主体增强服务暂时不可用。',
  );
}

/**
 * Creates the same framed view that the generation UI uses before an optional
 * cloud hint request. This compatibility export keeps the existing caller
 * isolated from the server contract; the default local path never invokes it.
 */
export async function createSubjectHintImage(
  source: Blob,
  settings: SubjectHintImageSettings,
): Promise<Blob> {
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  const longestSide = 1024;
  const aspect = settings.grid.columns / Math.max(1, settings.grid.rows);
  const width = Math.max(1, Math.round(aspect >= 1 ? longestSide : longestSide * aspect));
  const height = Math.max(1, Math.round(aspect >= 1 ? longestSide / aspect : longestSide));
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('无法创建主体增强预览。');
  }

  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const transform = settings.transform;
  if (settings.cropBox && settings.fit === 'crop') {
    const baseScale = Math.max(width / bitmap.width, height / bitmap.height);
    const scale = baseScale * Math.max(0.05, transform.scale);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    const drawX = (width - drawWidth) / 2 + transform.offsetX;
    const drawY = (height - drawHeight) / 2 + transform.offsetY;
    const sourceX = (settings.cropBox.x * width - drawX) / scale;
    const sourceY = (settings.cropBox.y * height - drawY) / scale;
    const sourceWidth = (settings.cropBox.width * width) / scale;
    const sourceHeight = (settings.cropBox.height * height) / scale;
    const sx = Math.max(0, Math.min(bitmap.width, sourceX));
    const sy = Math.max(0, Math.min(bitmap.height, sourceY));
    const ex = Math.max(0, Math.min(bitmap.width, sourceX + sourceWidth));
    const ey = Math.max(0, Math.min(bitmap.height, sourceY + sourceHeight));
    const target = fitWithinFrame(Math.max(1, ex - sx), Math.max(1, ey - sy), width, height);
    context.drawImage(
      bitmap,
      sx,
      sy,
      Math.max(1, ex - sx),
      Math.max(1, ey - sy),
      target.left,
      target.top,
      target.width,
      target.height,
    );
  } else {
    const baseScale = settings.fit === 'contain'
      ? Math.min(width / bitmap.width, height / bitmap.height)
      : Math.max(width / bitmap.width, height / bitmap.height);
    const scale = baseScale * Math.max(0.05, transform.scale);
    context.drawImage(
      bitmap,
      (width - bitmap.width * scale) / 2 + transform.offsetX,
      (height - bitmap.height * scale) / 2 + transform.offsetY,
      bitmap.width * scale,
      bitmap.height * scale,
    );
  }
  bitmap.close();

  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/png' });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('主体增强预览编码失败。'))),
      'image/png',
    );
  });
}
