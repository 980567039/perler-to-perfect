import { GENERATION_SAMPLE_SCALE } from '../domain/generation';
import { fitWithinFrame } from '../domain/framing';
import type { GenerationSettings } from '../domain/types';
import {
  PERFECT_PIXEL_ENDPOINT,
  type PerfectPixelRequest,
  type PerfectPixelResponse,
  type PerfectPixelSampleMethod,
  type PerfectPixelSuccess,
} from './perfectPixel.types';

const MAX_REQUEST_BYTES = 25 * 1024 * 1024;

export interface PerfectPixelClientOptions {
  endpoint?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  sampleMethod?: PerfectPixelSampleMethod;
  refineIntensity?: number;
  fixSquare?: boolean;
}

export interface PerfectPixelImageResult {
  imageData: ImageData;
  engine: 'perfect-pixel';
  version: string;
  width: number;
  height: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        if (reader.result instanceof ArrayBuffer) resolve(reader.result);
        else reject(new Error('无法读取 Perfect Pixel 输入图片。'));
      });
      reader.addEventListener('error', () => reject(reader.error ?? new Error('无法读取 Perfect Pixel 输入图片。')));
      reader.readAsArrayBuffer(blob);
    });
  }
  return new Response(blob).arrayBuffer();
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (blob.size < 1 || blob.size > MAX_REQUEST_BYTES) throw new Error('Perfect Pixel 输入图片无效或过大。');
  return `data:${blob.type || 'image/png'};base64,${bytesToBase64(new Uint8Array(await readBlobAsArrayBuffer(blob)))}`;
}

function createFrameCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToBlob(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/png' });
  }
  const htmlCanvas = canvas as HTMLCanvasElement;
  return new Promise<Blob>((resolve, reject) => {
    htmlCanvas.toBlob(
      (blob: Blob | null) => (blob ? resolve(blob) : reject(new Error('Perfect Pixel 输入图片编码失败。'))),
      'image/png',
    );
  });
}

/**
 * Render the exact same crop/zoom framing used by the editor into a square-cell
 * raster. The Python library then refines this raster without changing the
 * requested row/column count or the source aspect ratio.
 */
export async function createPerfectPixelFrame(
  source: Blob,
  settings: Pick<GenerationSettings, 'grid' | 'fit' | 'transform' | 'cropBox'>,
): Promise<Blob> {
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  const width = settings.grid.columns * GENERATION_SAMPLE_SCALE;
  const height = settings.grid.rows * GENERATION_SAMPLE_SCALE;
  const canvas = createFrameCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error('无法创建 Perfect Pixel 输入画布。');
  }

  try {
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
      const sw = Math.max(1, ex - sx);
      const sh = Math.max(1, ey - sy);
      const target = fitWithinFrame(sw, sh, width, height);
      context.drawImage(bitmap, sx, sy, sw, sh, target.left, target.top, target.width, target.height);
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
    return await canvasToBlob(canvas);
  } finally {
    bitmap.close();
  }
}

function isSuccess(value: unknown): value is PerfectPixelSuccess {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<PerfectPixelSuccess>;
  return response.ok === true &&
    response.engine === 'perfect-pixel' &&
    typeof response.image === 'string' &&
    typeof response.width === 'number' && Number.isInteger(response.width) && response.width > 0 &&
    typeof response.height === 'number' && Number.isInteger(response.height) && response.height > 0;
}

async function requestPerfectPixelResult(
  image: Blob,
  grid: { columns: number; rows: number },
  options: PerfectPixelClientOptions = {},
): Promise<PerfectPixelSuccess> {
  const request: PerfectPixelRequest = {
    image: await blobToDataUrl(image),
    sampleMethod: options.sampleMethod ?? 'majority',
    gridSize: [grid.columns, grid.rows],
    refineIntensity: Math.max(0, Math.min(0.5, options.refineIntensity ?? 0.25)),
    fixSquare: options.fixSquare ?? false,
  };
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(options.endpoint ?? PERFECT_PIXEL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: options.signal,
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error('Perfect Pixel 服务不可用。');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Perfect Pixel 服务返回了无效响应（${response.status}）。`);
  }
  if (!response.ok || !isSuccess(payload)) {
    const failure = payload as (Partial<PerfectPixelResponse> & { error?: unknown }) | null;
    throw new Error(
      typeof failure?.error === 'string'
        ? failure.error
        : `Perfect Pixel 服务返回 ${response.status}。`,
    );
  }
  if (payload.width !== grid.columns || payload.height !== grid.rows) {
    throw new Error(`Perfect Pixel 返回尺寸 ${payload.width}×${payload.height}，与目标 ${grid.columns}×${grid.rows} 不一致。`);
  }
  return payload;
}

/** Exposed for contract tests and integrations that already have a frame blob. */
export function requestPerfectPixel(
  image: Blob,
  grid: { columns: number; rows: number },
  options: PerfectPixelClientOptions = {},
): Promise<PerfectPixelSuccess> {
  return requestPerfectPixelResult(image, grid, options);
}

async function decodeSampledImage(
  result: PerfectPixelSuccess,
  grid: { columns: number; rows: number },
): Promise<ImageData> {
  const imageResponse = await fetch(result.image);
  if (!imageResponse.ok) throw new Error('无法读取 Perfect Pixel 采样结果。');
  const imageBlob = await imageResponse.blob();
  const bitmap = await createImageBitmap(imageBlob);
  const outputWidth = grid.columns * GENERATION_SAMPLE_SCALE;
  const outputHeight = grid.rows * GENERATION_SAMPLE_SCALE;
  const canvas = createFrameCanvas(outputWidth, outputHeight);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error('无法创建 Perfect Pixel 输出画布。');
  }
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, outputWidth, outputHeight);
  context.drawImage(bitmap, 0, 0, outputWidth, outputHeight);
  bitmap.close();
  const output = context.getImageData(0, 0, outputWidth, outputHeight);
  const alpha = result.alpha ? base64ToBytes(result.alpha) : new Uint8Array(grid.columns * grid.rows).fill(255);
  if (alpha.length !== grid.columns * grid.rows) throw new Error('Perfect Pixel alpha 数据长度无效。');
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const cellAlpha = alpha[row * grid.columns + column] ?? 0;
      for (let y = row * GENERATION_SAMPLE_SCALE; y < (row + 1) * GENERATION_SAMPLE_SCALE; y += 1) {
        for (let x = column * GENERATION_SAMPLE_SCALE; x < (column + 1) * GENERATION_SAMPLE_SCALE; x += 1) {
          output.data[(y * outputWidth + x) * 4 + 3] = cellAlpha;
        }
      }
    }
  }
  return output;
}

export async function requestPerfectPixelImage(
  source: Blob,
  settings: Pick<GenerationSettings, 'grid' | 'fit' | 'transform' | 'cropBox'>,
  options: PerfectPixelClientOptions = {},
): Promise<PerfectPixelImageResult> {
  const frame = await createPerfectPixelFrame(source, settings);
  const result = await requestPerfectPixelResult(frame, settings.grid, options);
  return {
    imageData: await decodeSampledImage(result, settings.grid),
    engine: result.engine,
    version: result.version,
    width: result.width,
    height: result.height,
  };
}
