import { afterEach, describe, expect, it, vi } from 'vitest';
import { RedinkBridge } from './redinkBridge';

const redinkOrigin = 'http://localhost:5173';

describe('RedInk bridge', () => {
  let bridge: RedinkBridge | null = null;

  afterEach(() => {
    bridge?.dispose();
    bridge = null;
    vi.unstubAllEnvs();
    window.history.replaceState({}, '', '/');
    Object.defineProperty(window, 'opener', { value: null, configurable: true });
  });

  it('accepts only the configured opener and transfers the source image', async () => {
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'opener', { value: parent, configurable: true });
    window.history.replaceState({}, '', '/?handoff=req-1');
    let received: File | undefined;
    bridge = new RedinkBridge(({ image }) => {
      received = image;
    });

    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PERLER_READY', requestId: 'req-1' }),
      redinkOrigin,
    );
    const image = new Uint8Array([1, 2, 3]).buffer;
    window.dispatchEvent(new MessageEvent('message', {
      source: parent as unknown as Window,
      origin: redinkOrigin,
      data: {
        channel: 'redink-perler',
        version: 1,
        type: 'IMPORT_IMAGE',
        requestId: 'req-1',
        context: { recordId: 'record-1', imageIndex: 0, fileName: 'source.png' },
        image,
        mimeType: 'image/png',
      },
    }));

    await vi.waitFor(() => expect(received).toBeInstanceOf(File));
    const file = received as File;
    expect(file.name).toBe('source.png');
    expect(file.type).toBe('image/png');
  });

  it('returns a PNG master to RedInk', async () => {
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'opener', { value: parent, configurable: true });
    window.history.replaceState({}, '', '/?handoff=req-2');
    bridge = new RedinkBridge(() => undefined);

    await bridge.sendPattern(new Blob(['png'], { type: 'image/png' }), {
      columns: 104,
      rows: 104,
      usedColors: 40,
    });

    expect(parent.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'PATTERN_READY', requestId: 'req-2', mimeType: 'image/png' }),
      redinkOrigin,
      expect.arrayContaining([expect.any(ArrayBuffer)]),
    );
  });

  it('normalizes a trailing slash in the configured origin', () => {
    vi.stubEnv('VITE_REDINK_ORIGIN', `${redinkOrigin}/`);
    Object.defineProperty(window, 'opener', { value: { postMessage: vi.fn() }, configurable: true });
    window.history.replaceState({}, '', '/?handoff=req-3');
    bridge = new RedinkBridge(() => undefined);

    expect(bridge.connected).toBe(true);
  });

  it('accepts optional RedInk grid settings without changing legacy payloads', async () => {
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'opener', { value: parent, configurable: true });
    window.history.replaceState({}, '', '/?handoff=req-settings');
    const onImport = vi.fn();
    bridge = new RedinkBridge(onImport);

    window.dispatchEvent(new MessageEvent('message', {
      source: parent as unknown as Window,
      origin: redinkOrigin,
      data: {
        channel: 'redink-perler',
        version: 1,
        type: 'IMPORT_IMAGE',
        requestId: 'req-settings',
        context: { recordId: 'record-1', imageIndex: 2, fileName: 'source.png' },
        image: new Uint8Array([1]).buffer,
        mimeType: 'image/png',
        settings: { columns: 80, rows: 120, maxUsedColors: 32 },
      },
    }));

    await vi.waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0]?.[0].settings).toEqual({ columns: 80, rows: 120, maxUsedColors: 32 });
  });

  it('rejects invalid optional manual settings', () => {
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'opener', { value: parent, configurable: true });
    window.history.replaceState({}, '', '/?handoff=req-invalid-settings');
    const onImport = vi.fn();
    bridge = new RedinkBridge(onImport);

    window.dispatchEvent(new MessageEvent('message', {
      source: parent as unknown as Window,
      origin: redinkOrigin,
      data: {
        channel: 'redink-perler',
        version: 1,
        type: 'IMPORT_IMAGE',
        requestId: 'req-invalid-settings',
        context: { recordId: 'record-1', imageIndex: 0, fileName: 'source.png' },
        image: new Uint8Array([1]).buffer,
        mimeType: 'image/png',
        settings: { columns: 0, rows: 104, maxUsedColors: 40 },
      },
    }));

    expect(onImport).not.toHaveBeenCalled();
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'PERLER_ERROR', requestId: 'req-invalid-settings' }),
      redinkOrigin,
    );
  });
});
