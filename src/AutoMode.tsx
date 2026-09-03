import { useEffect, useRef, useState } from 'react';
import { MARD_STANDARD_221_PALETTE } from './domain/mardPalette';
import { ALGORITHM_VERSION } from './domain/types';
import {
  createAutoGenerationSettings,
  decodeAutoSource,
  limitAutoPalette,
  refineAutoPattern,
  removeAutoBorderBackground,
} from './integrations/autoPattern';
import { RedinkAutoBridge, type RedinkAutoGeneratePayload } from './integrations/redinkAutoBridge';
import {
  renderAutoPatternPreview,
  renderAutoPatternIronedPreview,
} from './rendering/autoPatternPreview';
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

        if (generated.counts.length === 0) {
          throw new Error('mvp 生成后没有可用拼豆格，请进入 Perler 工作台手动调整。');
        }

        // Keep the automatic handoff deterministic and within the requested
        // production specification. The MVP sampler deliberately preserves
        // the full palette for editor fidelity, so the bridge applies the
        // automatic-only background and colour-limit passes here before all
        // three PNGs are rendered from the same cell matrix.
        bridge.sendProgress('background', 0, 1);
        const backgroundCleaned = payload.settings.removeBorderBackground
          ? removeAutoBorderBackground(generated)
          : generated;
        bridge.sendProgress('background', 1, 1);
        bridge.sendProgress('refine', 0, 1);
        const refined = refineAutoPattern(
          limitAutoPalette(backgroundCleaned, payload.settings.maxUsedColors),
          payload.settings.maxUsedColors,
          payload.settings.profile ?? 'balanced',
        );
        bridge.sendProgress('refine', 1, 1);

        setStatus('正在渲染拼豆效果图、熨烫效果图和母版…');
        bridge.sendProgress('render', 0, 3);
        const beads = await renderAutoPatternPreview({
          grid: refined.grid,
          cells: refined.cells,
          palette: MARD_STANDARD_221_PALETTE,
        });
        bridge.sendProgress('render', 1, 3);
        const ironed = await renderAutoPatternIronedPreview({
          grid: refined.grid,
          cells: refined.cells,
          palette: MARD_STANDARD_221_PALETTE,
        });
        bridge.sendProgress('render', 2, 3);
        const master = await exportMasterPattern({
          grid: refined.grid,
          cells: refined.cells,
          palette: MARD_STANDARD_221_PALETTE,
          watermarkEnabled: true,
        });
        bridge.sendProgress('render', 3, 3);
        await bridge.sendPattern(master, beads, ironed, {
          columns: refined.grid.columns,
          rows: refined.grid.rows,
          usedColors: refined.counts.length,
          profile: payload.settings.profile ?? 'detail',
          algorithmVersion: ALGORITHM_VERSION,
          sourceKind: payload.settings.sourceKind ?? 'original',
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
