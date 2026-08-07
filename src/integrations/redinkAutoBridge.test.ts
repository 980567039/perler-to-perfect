import { afterEach, describe, expect, it, vi } from 'vitest';
import { RedinkAutoBridge, isRedinkAutoMode } from './redinkAutoBridge';

const redinkOrigin = 'http://localhost:5173';

function autoMessage(overrides: Record<string, unknown> = {}) {
  return {
    channel: 'redink-perler-auto',
    version: 1,
    type: 'AUTO_GENERATE',
    requestId: 'auto-1',
    context: { recordId: 'record-1', imageIndex: 0, fileName: 'source.png' },
    image: new Uint8Array([1, 2, 3]).buffer,
    mimeType: 'image/png',
    settings: { columns: 104, rows: 104, maxUsedColors: 40, removeBorderBackground: true },
    ...overrides,
  };
}

describe('RedInk automatic bridge', () => {
  let bridge: RedinkAutoBridge | null = null;

  afterEach(() => {
    bridge?.dispose();
    bridge = null;
    vi.unstubAllEnvs();
    window.history.replaceState({}, '', '/');
    Object.defineProperty(window, 'parent', { value: window, configurable: true });
  });

  it('selects auto mode only for the explicit mode query', () => {
    expect(isRedinkAutoMode('?mode=auto&handoff=req')).toBe(true);
    expect(isRedinkAutoMode('?handoff=req')).toBe(false);
    expect(isRedinkAutoMode('?mode=manual&handoff=req')).toBe(false);
  });

  it('announces readiness and accepts a valid request only from the configured parent', async () => {
    const parent = { postMessage: vi.fn() };
    const stranger = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', { value: parent, configurable: true });
    window.history.replaceState({}, '', '/?mode=auto&handoff=auto-1');
    const onGenerate = vi.fn();
    bridge = new RedinkAutoBridge(onGenerate);

    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'redink-perler-auto',
        version: 1,
        type: 'AUTO_READY',
        requestId: 'auto-1',
      }),
      redinkOrigin,
    );

    window.dispatchEvent(new MessageEvent('message', {
      source: stranger as unknown as Window,
      origin: redinkOrigin,
      data: autoMessage(),
    }));
    window.dispatchEvent(new MessageEvent('message', {
      source: parent as unknown as Window,
      origin: 'https://example.invalid',
      data: autoMessage(),
    }));
    expect(onGenerate).not.toHaveBeenCalled();

    window.dispatchEvent(new MessageEvent('message', {
      source: parent as unknown as Window,
      origin: redinkOrigin,
      data: autoMessage(),
    }));

    await vi.waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    expect(onGenerate.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      requestId: 'auto-1',
      context: { recordId: 'record-1', imageIndex: 0, fileName: 'source.png' },
      image: expect.any(File),
      settings: { columns: 104, rows: 104, maxUsedColors: 40, removeBorderBackground: true },
    }));
  });

  it('rejects invalid settings and does not start generation', () => {
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', { value: parent, configurable: true });
    window.history.replaceState({}, '', '/?mode=auto&handoff=auto-1');
    const onGenerate = vi.fn();
    bridge = new RedinkAutoBridge(onGenerate);

    window.dispatchEvent(new MessageEvent('message', {
      source: parent as unknown as Window,
      origin: redinkOrigin,
      data: autoMessage({
        settings: { columns: 301, rows: 104, maxUsedColors: 40, removeBorderBackground: true },
      }),
    }));

    expect(onGenerate).not.toHaveBeenCalled();
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'AUTO_ERROR', requestId: 'auto-1' }),
      redinkOrigin,
      [],
    );
  });

  it('sends protocol progress and a PNG master with transfer ownership', async () => {
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', { value: parent, configurable: true });
    window.history.replaceState({}, '', '/?mode=auto&handoff=auto-1');
    bridge = new RedinkAutoBridge(() => undefined);

    bridge.sendProgress('render', 1, 1);
    await bridge.sendPattern(new Blob(['png'], { type: 'image/png' }), {
      columns: 104,
      rows: 104,
      usedColors: 12,
    });

    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'AUTO_PROGRESS', stage: 'render', completed: 1, total: 1 }),
      redinkOrigin,
      [],
    );
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'AUTO_PATTERN_READY',
        requestId: 'auto-1',
        mimeType: 'image/png',
        metadata: { columns: 104, rows: 104, usedColors: 12 },
      }),
      redinkOrigin,
      expect.arrayContaining([expect.any(ArrayBuffer)]),
    );
  });
});
