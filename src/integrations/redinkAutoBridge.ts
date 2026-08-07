import { MAX_SOURCE_BYTES, MAX_SOURCE_PIXELS } from '../domain/types';
import type { PatternMetadata, RedinkImageContext } from './redinkBridge';

const CHANNEL = 'redink-perler-auto';
const VERSION = 1 as const;
const MAX_PATTERN_BYTES = 20 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export type AutoProgressStage =
  | 'prepare'
  | 'sample'
  | 'select'
  | 'map'
  | 'cleanup'
  | 'background'
  | 'refine'
  | 'render';

export interface AutoGenerationSettings {
  columns: number;
  rows: number;
  maxUsedColors: number;
  removeBorderBackground: true;
}

export interface RedinkAutoGeneratePayload {
  requestId: string;
  context: RedinkImageContext;
  image: File;
  settings: AutoGenerationSettings;
}

interface AutoBridgeMessage {
  channel: typeof CHANNEL;
  version: typeof VERSION;
  type: string;
  requestId?: string;
  context?: RedinkImageContext;
  image?: ArrayBuffer;
  mimeType?: string;
  settings?: AutoGenerationSettings;
}

function configuredRedinkOrigin(): string | null {
  const configured = import.meta.env.VITE_REDINK_ORIGIN?.trim() || 'http://localhost:5173';
  try {
    const parsed = new URL(configured);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function isValidContext(value: unknown): value is RedinkImageContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<RedinkImageContext>;
  return (
    typeof context.recordId === 'string' && context.recordId.length > 0 && context.recordId.length <= 128 &&
    Number.isInteger(context.imageIndex) && context.imageIndex! >= 0 && context.imageIndex! <= 300 &&
    typeof context.fileName === 'string' && context.fileName.length > 0 && context.fileName.length <= 255
  );
}

function isValidSettings(value: unknown): value is AutoGenerationSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<AutoGenerationSettings>;
  return (
    Number.isInteger(settings.columns) && settings.columns! >= 1 && settings.columns! <= 300 &&
    Number.isInteger(settings.rows) && settings.rows! >= 1 && settings.rows! <= 300 &&
    Number.isInteger(settings.maxUsedColors) && settings.maxUsedColors! >= 2 && settings.maxUsedColors! <= 64 &&
    settings.removeBorderBackground === true
  );
}

function isValidMetadata(value: PatternMetadata): boolean {
  return (
    Number.isInteger(value.columns) && value.columns >= 1 && value.columns <= 300 &&
    Number.isInteger(value.rows) && value.rows >= 1 && value.rows <= 300 &&
    Number.isInteger(value.usedColors) && value.usedColors >= 1 && value.usedColors <= 64
  );
}

function isAutoBridgeMessage(value: unknown): value is AutoBridgeMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<AutoBridgeMessage>;
  return message.channel === CHANNEL && message.version === VERSION && typeof message.type === 'string';
}

export class RedinkAutoBridge {
  readonly requestId: string | null;
  readonly connected: boolean;
  private readonly parentWindow: Window | null;
  private readonly redinkOrigin: string;
  private readonly onGenerate: (payload: RedinkAutoGeneratePayload) => void | Promise<void>;
  private accepted = false;
  private disposed = false;

  constructor(onGenerate: (payload: RedinkAutoGeneratePayload) => void | Promise<void>) {
    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('handoff');
    const origin = configuredRedinkOrigin();
    this.requestId = requestedId && REQUEST_ID_PATTERN.test(requestedId) ? requestedId : null;
    this.parentWindow = window.parent !== window ? window.parent : null;
    this.redinkOrigin = origin || '';
    this.connected = Boolean(this.requestId && this.parentWindow && origin && params.get('mode') === 'auto');
    this.onGenerate = onGenerate;

    if (this.connected) {
      window.addEventListener('message', this.handleMessage);
      this.parentWindow!.postMessage(
        { channel: CHANNEL, version: VERSION, type: 'AUTO_READY', requestId: this.requestId },
        this.redinkOrigin,
      );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('message', this.handleMessage);
  }

  sendProgress(stage: AutoProgressStage, completed: number, total: number): void {
    if (!Number.isInteger(completed) || !Number.isInteger(total) || completed < 0 || total < 1 || completed > total) {
      throw new Error('自动生成进度无效。');
    }
    this.post({ type: 'AUTO_PROGRESS', stage, completed, total });
  }

  async sendPattern(master: Blob, preview: Blob, metadata: PatternMetadata): Promise<void> {
    this.validatePng(master, '图纸母版', MAX_PATTERN_BYTES);
    this.validatePng(preview, '效果预览', MAX_PREVIEW_BYTES);
    if (!isValidMetadata(metadata)) throw new Error('图纸元数据无效。');
    const [pattern, previewBuffer] = await Promise.all([
      this.blobToArrayBuffer(master),
      this.blobToArrayBuffer(preview),
    ]);
    this.post(
      {
        type: 'AUTO_PATTERN_READY',
        pattern,
        mimeType: 'image/png',
        preview: previewBuffer,
        previewMimeType: 'image/png',
        metadata,
      },
      [pattern, previewBuffer],
    );
  }

  sendError(message: string): void {
    const normalized = message.trim().slice(0, 500) || '自动生成图纸失败。';
    this.post({ type: 'AUTO_ERROR', message: normalized });
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    if (
      this.disposed ||
      !this.connected ||
      this.accepted ||
      event.source !== this.parentWindow ||
      event.origin !== this.redinkOrigin ||
      !isAutoBridgeMessage(event.data)
    ) return;
    const message = event.data;
    if (message.requestId !== this.requestId || message.type !== 'AUTO_GENERATE') return;
    if (!(message.image instanceof ArrayBuffer) || message.image.byteLength === 0 || message.image.byteLength > MAX_SOURCE_BYTES) {
      this.sendError('图片文件无效或超过 25MB。');
      return;
    }
    if (!message.mimeType || !ALLOWED_IMAGE_TYPES.has(message.mimeType) || !isValidContext(message.context)) {
      this.sendError('图片类型或交接上下文无效。');
      return;
    }
    if (!isValidSettings(message.settings)) {
      this.sendError('图纸规格无效；行列必须为 1–300，最大用色数必须为 2–64。');
      return;
    }

    this.accepted = true;
    const fileName = message.context.fileName.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) || 'redink-source.png';
    const image = new File([message.image], fileName, { type: message.mimeType });
    void Promise.resolve(this.onGenerate({
      requestId: this.requestId!,
      context: message.context,
      image,
      settings: message.settings,
    })).catch((error: unknown) => {
      this.sendError(error instanceof Error ? error.message : '自动生成图纸失败。');
    });
  };

  private post(
    payload: Record<string, unknown>,
    transfer: Transferable[] = [],
  ): void {
    if (this.disposed || !this.connected || !this.parentWindow || !this.requestId) return;
    this.parentWindow.postMessage(
      { channel: CHANNEL, version: VERSION, requestId: this.requestId, ...payload },
      this.redinkOrigin,
      transfer,
    );
  }

  private validatePng(image: Blob, label: string, maxBytes: number): void {
    if (!(image instanceof Blob) || image.type !== 'image/png' || image.size === 0 || image.size > maxBytes) {
      throw new Error(`${label}必须是 ${maxBytes / 1024 / 1024}MB 以内的 PNG。`);
    }
  }

  private async blobToArrayBuffer(image: Blob): Promise<ArrayBuffer> {
    return typeof image.arrayBuffer === 'function'
      ? image.arrayBuffer()
      : new Response(image).arrayBuffer();
  }
}

export function isRedinkAutoMode(search = window.location.search): boolean {
  return new URLSearchParams(search).get('mode') === 'auto';
}

export const redinkAutoBridgeLimits = {
  maxBytes: MAX_SOURCE_BYTES,
  maxPatternBytes: MAX_PATTERN_BYTES,
  maxPreviewBytes: MAX_PREVIEW_BYTES,
  maxSourcePixels: MAX_SOURCE_PIXELS,
  allowedImageTypes: [...ALLOWED_IMAGE_TYPES],
};
