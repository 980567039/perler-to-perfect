import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEVELOPMENT_PALETTE } from '../domain/devPalette';
import { createDefaultSettings } from '../domain/types';
import { startGeneration } from './generate.client';

describe('generation client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('terminates the worker and settles the task when cancelled', async () => {
    let workerInstance: FakeWorker | null = null;

    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage = vi.fn();
      terminate = vi.fn();

      constructor() {
        workerInstance = this;
      }
    }

    vi.stubGlobal('Worker', FakeWorker);
    const task = startGeneration(
      {} as ImageBitmap,
      DEVELOPMENT_PALETTE,
      createDefaultSettings(DEVELOPMENT_PALETTE),
      vi.fn(),
    );

    task.cancel();

    await expect(task.promise).rejects.toThrow('任务已取消。');
    expect(workerInstance).not.toBeNull();
    expect(workerInstance!.terminate).toHaveBeenCalledTimes(1);
    task.cancel();
    expect(workerInstance!.terminate).toHaveBeenCalledTimes(1);
  });
});
