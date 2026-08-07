import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEVELOPMENT_PALETTE } from '../domain/devPalette';
import { exportMasterPattern } from './export.client';

describe('master-only export client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests only a master PNG and does not request legend or ZIP fields', async () => {
    let request: Record<string, unknown> | null = null;
    let transfer: Transferable[] | undefined;
    let workerInstance: FakeWorker | null = null;

    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      terminate = vi.fn();

      constructor() {
        workerInstance = this;
      }

      postMessage(message: Record<string, unknown>, transferred: Transferable[]) {
        request = message;
        transfer = transferred;
        queueMicrotask(() => this.onmessage?.({
          data: {
            type: 'MASTER_RESULT',
            jobId: message.jobId,
            master: new Uint8Array([1, 2, 3]).buffer,
          },
        } as MessageEvent));
      }
    }

    vi.stubGlobal('Worker', FakeWorker);
    const master = await exportMasterPattern({
      grid: { columns: 2, rows: 2 },
      cells: new Uint16Array([0, 1, 0, 1]),
      palette: DEVELOPMENT_PALETTE,
      watermarkEnabled: true,
    });

    expect(request).toEqual(expect.objectContaining({
      type: 'EXPORT_MASTER',
      grid: { columns: 2, rows: 2 },
      palette: DEVELOPMENT_PALETTE,
      watermarkEnabled: true,
    }));
    expect(request).not.toHaveProperty('projectName');
    expect(request).not.toHaveProperty('counts');
    expect(request).not.toHaveProperty('tileSize');
    expect(transfer).toHaveLength(1);
    expect(master.type).toBe('image/png');
    expect(master.size).toBe(3);
    expect(workerInstance).not.toBeNull();
    expect(workerInstance!.terminate).toHaveBeenCalledTimes(1);
  });
});
