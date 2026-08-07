import { useEffect, useRef, useState } from 'react';
import { MARD_STANDARD_221_PALETTE } from './domain/mardPalette';
import { createAutoGenerationSettings, decodeAutoSource, removeAutoBorderBackground } from './integrations/autoPattern';
import { RedinkAutoBridge, type RedinkAutoGeneratePayload } from './integrations/redinkAutoBridge';
import { exportMasterPattern } from './workers/export.client';
import { startGeneration, type GenerationTask } from './workers/generate.client';

export function AutoMode() {
  const [status, setStatus] = useState('正在连接 RedInk…');
  const generationTask = useRef<GenerationTask | null>(null);

  useEffect(() => {
    let disposed = false;
    let bridge: RedinkAutoBridge | null = null;

    const handleGenerate = async (payload: RedinkAutoGeneratePayload) => {
      if (!bridge) throw new Error('自动交接尚未就绪。');
      try {
        if (typeof OffscreenCanvas === 'undefined') {
          throw new Error('当前浏览器不支持 OffscreenCanvas，请使用最新版桌面 Chrome 或 Edge。');
        }

        setStatus('正在解析图片…');
        bridge.sendProgress('prepare', 0, 1);
        const bitmap = await decodeAutoSource(payload.image);
        let task: GenerationTask;
        try {
          task = startGeneration(
            bitmap,
            MARD_STANDARD_221_PALETTE,
            createAutoGenerationSettings(payload.settings),
            (message) => bridge?.sendProgress(message.stage, message.completed, Math.max(1, message.total)),
          );
        } catch (error) {
          bitmap.close();
          throw error;
        }
        generationTask.current = task;
        setStatus('正在生成拼豆图纸…');
        const generated = await task.promise;
        generationTask.current = null;

        bridge.sendProgress('background', 0, 1);
        const result = removeAutoBorderBackground(generated);
        bridge.sendProgress('background', 1, 1);
        if (result.counts.length === 0) {
          throw new Error('背景移除后没有可用拼豆格，请进入 Perler 工作台手动调整。');
        }

        setStatus('正在渲染母版…');
        bridge.sendProgress('render', 0, 1);
        const master = await exportMasterPattern({
          grid: result.grid,
          cells: result.cells,
          palette: MARD_STANDARD_221_PALETTE,
          watermarkEnabled: true,
        });
        bridge.sendProgress('render', 1, 1);
        await bridge.sendPattern(master, {
          columns: result.grid.columns,
          rows: result.grid.rows,
          usedColors: result.counts.length,
        });
        if (!disposed) setStatus('图纸已回传 RedInk。');
      } catch (error) {
        generationTask.current = null;
        if (!disposed) setStatus('自动生成失败。');
        throw error;
      }
    };

    bridge = new RedinkAutoBridge(handleGenerate);
    if (bridge.connected) setStatus('已连接 RedInk，等待图片…');
    else setStatus('自动交接参数无效或页面未嵌入 RedInk。');

    return () => {
      disposed = true;
      generationTask.current?.cancel();
      generationTask.current = null;
      bridge?.dispose();
      bridge = null;
    };
  }, []);

  return <main aria-live="polite">{status}</main>;
}
