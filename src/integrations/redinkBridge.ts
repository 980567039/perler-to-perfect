const CHANNEL = 'redink-perler';
const VERSION = 1 as const;
const MAX_HANDOFF_BYTES = 25 * 1024 * 1024;
const MAX_PATTERN_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface RedinkImageContext {
  recordId: string;
  imageIndex: number;
  fileName: string;
}

export interface RedinkGenerationSettings {
  columns: number;
  rows: number;
  maxUsedColors: number;
}

export interface RedinkImportPayload {
  requestId: string;
  context: RedinkImageContext;
  image: File;
  settings?: RedinkGenerationSettings;
}

export interface PatternMetadata {
  columns: number;
  rows: number;
  usedColors: number;
}

interface BridgeMessage {
  channel: typeof CHANNEL;
  version: typeof VERSION;
  type: string;
  requestId?: string;
  context?: RedinkImageContext;
  image?: ArrayBuffer;
  mimeType?: string;
  pattern?: ArrayBuffer;
  metadata?: PatternMetadata;
  settings?: RedinkGenerationSettings;
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

function isValidMetadata(value: unknown): value is PatternMetadata {
  if (!value || typeof value !== 'object') return false;
  const metadata = value as Partial<PatternMetadata>;
  return (
    Number.isInteger(metadata.columns) && metadata.columns! >= 1 && metadata.columns! <= 300 &&
    Number.isInteger(metadata.rows) && metadata.rows! >= 1 && metadata.rows! <= 300 &&
    Number.isInteger(metadata.usedColors) && metadata.usedColors! >= 1 && metadata.usedColors! <= 64
  );
}

function isValidGenerationSettings(value: unknown): value is RedinkGenerationSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<RedinkGenerationSettings>;
  return (
    Number.isInteger(settings.columns) && settings.columns! >= 1 && settings.columns! <= 300 &&
    Number.isInteger(settings.rows) && settings.rows! >= 1 && settings.rows! <= 300 &&
    Number.isInteger(settings.maxUsedColors) && settings.maxUsedColors! >= 2 && settings.maxUsedColors! <= 64
  );
}

function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<BridgeMessage>;
  return message.channel === CHANNEL && message.version === VERSION && typeof message.type === 'string';
}

export class RedinkBridge {
  readonly requestId: string | null;
  readonly connected: boolean;
  private readonly parentWindow: Window | null;
  private readonly redinkOrigin: string;
  private readonly onImport: (payload: RedinkImportPayload) => void | Promise<void>;
  private disposed = false;

  constructor(onImport: (payload: RedinkImportPayload) => void | Promise<void>) {
    const params = new URLSearchParams(window.location.search);
    const requestId = params.get('handoff');
    const origin = configuredRedinkOrigin();
    this.requestId = requestId && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId) ? requestId : null;
    this.parentWindow = window.opener;
    this.redinkOrigin = origin || '';
    this.connected = Boolean(this.requestId && this.parentWindow && origin);
    this.onImport = onImport;

    if (this.connected) {
      window.addEventListener('message', this.handleMessage);
      this.parentWindow!.postMessage(
        { channel: CHANNEL, version: VERSION, type: 'PERLER_READY', requestId: this.requestId },
        this.redinkOrigin,
      );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('message', this.handleMessage);
  }

  async sendPattern(master: Blob, metadata: PatternMetadata): Promise<void> {
    if (!this.connected || !this.parentWindow || !this.requestId) {
      throw new Error('当前不是从 RedInk 打开的联动窗口。');
    }
    if (master.type !== 'image/png' || master.size === 0 || master.size > MAX_PATTERN_BYTES) {
      throw new Error('图纸母版必须是 20MB 以内的 PNG。');
    }
    if (!isValidMetadata(metadata)) throw new Error('图纸元数据无效。');
    const pattern = typeof master.arrayBuffer === 'function'
      ? await master.arrayBuffer()
      : await new Response(master).arrayBuffer();
    this.parentWindow.postMessage(
      {
        channel: CHANNEL,
        version: VERSION,
        type: 'PATTERN_READY',
        requestId: this.requestId,
        pattern,
        mimeType: 'image/png',
        metadata,
      },
      this.redinkOrigin,
      [pattern],
    );
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    if (this.disposed || !this.connected || event.source !== this.parentWindow || event.origin !== this.redinkOrigin) return;
    if (!isBridgeMessage(event.data)) return;
    const message = event.data;
    if (message.requestId !== this.requestId || message.type !== 'IMPORT_IMAGE') return;
    if (!(message.image instanceof ArrayBuffer) || message.image.byteLength === 0 || message.image.byteLength > MAX_HANDOFF_BYTES) {
      this.sendError('图片文件无效或超过 25MB。');
      return;
    }
    if (!message.mimeType || !ALLOWED_IMAGE_TYPES.has(message.mimeType) || !isValidContext(message.context)) {
      this.sendError('图片类型或交接上下文无效。');
      return;
    }
    if (message.settings !== undefined && !isValidGenerationSettings(message.settings)) {
      this.sendError('图纸规格无效；行列必须为 1–300，最大用色数必须为 2–64。');
      return;
    }
    const fileName = message.context.fileName.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) || 'redink-source.png';
    const file = new File([message.image], fileName, { type: message.mimeType });
    void Promise.resolve(this.onImport({
      requestId: this.requestId!,
      context: message.context,
      image: file,
      settings: message.settings,
    })).catch((error: unknown) => {
      this.sendError(error instanceof Error ? error.message : '导入图片失败。');
    });
  };

  private sendError(message: string): void {
    if (!this.connected || !this.parentWindow || !this.requestId) return;
    this.parentWindow.postMessage(
      { channel: CHANNEL, version: VERSION, type: 'PERLER_ERROR', requestId: this.requestId, message },
      this.redinkOrigin,
    );
  }
}

export function isRedinkHandoff(): boolean {
  return new URLSearchParams(window.location.search).has('handoff');
}

export const redinkBridgeLimits = {
  maxBytes: MAX_HANDOFF_BYTES,
  allowedImageTypes: [...ALLOWED_IMAGE_TYPES],
};
