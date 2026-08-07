import { useEffect, useMemo, useRef, useState } from 'react';
import { CropPreview } from './components/CropPreview';
import { PatternCanvas, type EditorTool } from './components/PatternCanvas';
import { PalettePanel } from './components/PalettePanel';
import { ALGORITHM_VERSION, MAX_SOURCE_BYTES, MAX_SOURCE_PIXELS, type GenerateResponse } from './domain/types';
import { MARD_STANDARD_221_PALETTE } from './domain/mardPalette';
import { paletteFromFileContents } from './domain/palette';
import { loadMostRecentProject, saveProject } from './persistence/database';
import {
  createProjectSnapshot,
  downloadTextFile,
  hashBlob,
  parseProject,
  safeFileStem,
  serializeProject,
} from './persistence/projectFile';
import { useProjectStore } from './state/projectStore';
import { startGeneration, type GenerationTask } from './workers/generate.client';
import { exportPattern } from './workers/export.client';
import { RedinkBridge, type RedinkImportPayload } from './integrations/redinkBridge';

const stageLabels: Record<Extract<GenerateResponse, { type: 'PROGRESS' }>['stage'], string> = {
  prepare: '准备图像',
  sample: '提取格子代表色',
  select: '选择有限色板',
  map: '映射拼豆色号',
  cleanup: '清理小杂色',
};

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function clampInteger(value: string, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

export function App() {
  const store = useProjectStore();
  const loadProject = useProjectStore((state) => state.loadProject);
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceDimensions, setSourceDimensions] = useState<{ width: number; height: number } | null>(null);
  const [selectedPaletteIndex, setSelectedPaletteIndex] = useState(0);
  const [tool, setTool] = useState<EditorTool>('paint');
  const [previewMode, setPreviewMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ label: '', completed: 0, total: 1 });
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ label: '', completed: 0, total: 1 });
  const [tileSize, setTileSize] = useState(50);
  const [notice, setNotice] = useState('已载入 MARD 标准 221 色；HEX 为屏幕近似值，实体颜色可能受光线和批次影响。');
  const [error, setError] = useState<string | null>(null);
  const [handoffContext, setHandoffContext] = useState<RedinkImportPayload['context'] | null>(null);
  const generationTask = useRef<GenerationTask | null>(null);
  const redinkBridge = useRef<RedinkBridge | null>(null);
  const autoGenerateAfterImport = useRef(false);

  const selectedColor = store.palette.colors[selectedPaletteIndex] ?? store.palette.colors[0];
  const usedPaletteIndices = useMemo(() => new Set(store.counts.map((entry) => entry.paletteIndex)), [store.counts]);
  const enabledSet = useMemo(() => new Set(store.settings.enabledColorIds), [store.settings.enabledColorIds]);

  useEffect(() => {
    let cancelled = false;
    const revisionAtStart = useProjectStore.getState().revision;

    void loadMostRecentProject()
      .then(async (record) => {
        if (!record || cancelled || useProjectStore.getState().revision !== revisionAtStart) return;

        let dimensions: { width: number; height: number } | null = null;
        if (record.sourceBlob) {
          try {
            const bitmap = await createImageBitmap(record.sourceBlob, { imageOrientation: 'from-image' });
            dimensions = { width: bitmap.width, height: bitmap.height };
            bitmap.close();
          } catch {
            dimensions = null;
          }
        }

        if (cancelled || useProjectStore.getState().revision !== revisionAtStart) return;
        loadProject(record.project);
        if (record.sourceBlob) {
          setSourceBlob(record.sourceBlob);
          setSourceUrl((currentUrl) => {
            if (currentUrl) URL.revokeObjectURL(currentUrl);
            return URL.createObjectURL(record.sourceBlob!);
          });
          setSourceDimensions(dimensions);
        }
        setNotice(`已恢复本机自动保存：${record.project.name}`);
      })
      .catch(() => {
        if (!cancelled) setNotice('没有恢复自动保存；你可以导入工程 JSON。');
      });

    return () => {
      cancelled = true;
    };
  }, [loadProject]);

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
  }, [sourceUrl]);

  useEffect(() => {
    if (!store.cells || !store.source) return;
    const timeout = window.setTimeout(() => {
      const snapshot = createProjectSnapshot({
        projectId: store.projectId,
        projectName: store.projectName,
        createdAt: store.createdAt,
        palette: store.palette,
        settings: store.settings,
        watermarkEnabled: store.watermarkEnabled,
        cells: store.cells!,
        source: store.source!,
      });
      void saveProject(snapshot, sourceBlob ?? undefined).catch(() => setNotice('自动保存失败，请手动导出工程 JSON。'));
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [sourceBlob, store.cells, store.createdAt, store.palette, store.projectId, store.projectName, store.revision, store.settings, store.source, store.watermarkEnabled]);

  useEffect(() => {
    if (selectedPaletteIndex >= store.palette.colors.length) setSelectedPaletteIndex(0);
  }, [selectedPaletteIndex, store.palette.colors.length]);

  const handleImageFile = async (file: File) => {
    setError(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      throw new Error('只支持 PNG、JPEG 和 WebP 图片。');
    }
    if (file.size > MAX_SOURCE_BYTES) throw new Error('图片超过 25MB，请先压缩。');
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const pixels = bitmap.width * bitmap.height;
    if (pixels > MAX_SOURCE_PIXELS) {
      bitmap.close();
      throw new Error('图片解码后超过 4000 万像素，请先缩小。');
    }
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    const sha256 = await hashBlob(file);
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceBlob(file);
    setSourceUrl(URL.createObjectURL(file));
    setSourceDimensions(dimensions);
    store.updateSettings({
      ...store.settings,
      fit: 'crop',
      transform: { scale: 1, offsetX: 0, offsetY: 0 },
      cropBox: undefined,
    });
    store.setSource({ fileName: file.name, mimeType: file.type, sha256 });
    store.setProjectName(file.name.replace(/\.[^.]+$/, '') || '未命名拼豆图纸');
    setNotice(`已载入 ${dimensions.width}×${dimensions.height}，图片仅在本机处理。`);
  };

  const handleGenerate = async () => {
    if (!sourceBlob) {
      setError('请先导入原图；导入工程 JSON 后若需重新生成，也要重新选择原图。');
      return;
    }
    setError(null);
    setIsGenerating(true);
    try {
      const bitmap = await createImageBitmap(sourceBlob, { imageOrientation: 'from-image' });
      const task = startGeneration(bitmap, store.palette, store.settings, (message) => {
        setGenerationProgress({
          label: stageLabels[message.stage],
          completed: message.completed,
          total: Math.max(1, message.total),
        });
      });
      generationTask.current = task;
      const result = await task.promise;
      store.setPattern(result);
      const firstUsed = result.selectedPaletteIndices[0];
      if (firstUsed !== undefined) setSelectedPaletteIndex(firstUsed);
      setNotice(`生成完成：${result.grid.columns}×${result.grid.rows}，${result.counts.length} 色，${result.totalBeads} 颗。`);
    } catch (reason) {
      if (reason instanceof Error && reason.message === '任务已取消。') {
        setNotice('已取消生成任务。');
      } else {
        setError(reason instanceof Error ? reason.message : '生成失败。');
      }
    } finally {
      generationTask.current = null;
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (!sourceBlob || !autoGenerateAfterImport.current || isGenerating) return;
    autoGenerateAfterImport.current = false;
    void handleGenerate();
  }, [isGenerating, sourceBlob]);

  const handleRedinkImport = async (payload: RedinkImportPayload) => {
    await handleImageFile(payload.image);
    setHandoffContext(payload.context);
    autoGenerateAfterImport.current = true;
    const settings = payload.settings ?? { columns: 104, rows: 104, maxUsedColors: 40 };
    setNotice(
      `已从 RedInk 接收拼豆源图，正在按 ${settings.columns}×${settings.rows}、${settings.maxUsedColors} 色、细节优先生成。`,
    );
    updateSetting({
      grid: { columns: settings.columns, rows: settings.rows },
      maxUsedColors: settings.maxUsedColors,
      minimumPaletteDistance: 4,
      detailPriority: true,
      cleanupRegionSize: 2,
    });
  };

  useEffect(() => {
    const bridge = new RedinkBridge(handleRedinkImport);
    redinkBridge.current = bridge;
    if (bridge.connected) setNotice('已连接 RedInk，等待拼豆源图。');
    return () => {
      bridge.dispose();
      if (redinkBridge.current === bridge) redinkBridge.current = null;
    };
  }, []);

  const updateSetting = (patch: Partial<typeof store.settings>) => {
    store.updateSettings({ ...store.settings, ...patch });
  };

  const toggleEnabledColor = (id: string) => {
    const next = new Set(store.settings.enabledColorIds);
    if (next.has(id)) {
      if (next.size <= 2) {
        setError('至少保留两个启用色号。');
        return;
      }
      next.delete(id);
    } else {
      next.add(id);
    }
    const enabledColorIds = store.palette.colors.map((color) => color.id).filter((colorId) => next.has(colorId));
    const lockedColorIds = store.settings.lockedColorIds.filter((colorId) => next.has(colorId));
    const maxUsedColors = Math.min(store.settings.maxUsedColors, enabledColorIds.length);
    updateSetting({ enabledColorIds, lockedColorIds, maxUsedColors });
  };

  const toggleLockedColor = (id: string) => {
    if (!store.settings.enabledColorIds.includes(id)) {
      setError('锁定色必须先启用。');
      return;
    }
    const lockedColorIds = store.settings.lockedColorIds.includes(id)
      ? store.settings.lockedColorIds.filter((colorId) => colorId !== id)
      : [...store.settings.lockedColorIds, id];
    if (lockedColorIds.length > store.settings.maxUsedColors) {
      setError('锁定色数量不能超过实际用色上限。');
      return;
    }
    updateSetting({ lockedColorIds });
    setError(null);
  };

  const handlePickColor = (paletteIndex: number | null) => {
    if (paletteIndex === null) {
      setError('吸色失败：这个格子是空格，请点击有颜色的格子。');
      return;
    }
    const color = store.palette.colors[paletteIndex];
    if (!color) return;
    setSelectedPaletteIndex(paletteIndex);
    setError(null);
    setNotice(`已吸取色号 ${color.code}，当前画笔颜色已更新；点击“画笔”结束吸色。`);
  };

  const handleMagicWand = (index: number) => {
    const removed = store.magicWand(index);
    if (removed > 0) {
      setError(null);
      setNotice(`魔棒已擦除连续同色区域：${removed} 格；可继续点击其他杂物，支持撤销。`);
    } else {
      setError('魔棒请点击有颜色的连续区域。');
    }
  };

  const handleKeepLargestComponent = () => {
    const removed = store.keepLargestComponent();
    if (removed > 0) {
      setError(null);
      setNotice(`已仅保留最大主体，清除 ${removed} 格外围杂物；如需恢复可撤销。`);
    } else {
      setNotice('未发现主体外的独立杂物。');
    }
  };

  const handlePaletteFile = async (file: File) => {
    setError(null);
    try {
      const palette = paletteFromFileContents(await file.text(), file.name);
      store.setPalette(palette);
      setSelectedPaletteIndex(0);
      setNotice(`已导入色板：${palette.brand} / ${palette.edition}，共 ${palette.colors.length} 色。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '色板导入失败。');
    }
  };

  const handleProjectFile = async (file: File) => {
    setError(null);
    try {
      const project = parseProject(await file.text());
      store.loadProject(project);
      setSourceBlob(null);
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      setSourceUrl(project.source.thumbnailDataUrl ?? null);
      setSourceDimensions(null);
      setSelectedPaletteIndex(project.cellsRle[0]?.[0] ?? 0);
      setNotice('工程已导入；可继续精修和导出。重新生成时请重新选择原图。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工程导入失败。');
    }
  };

  const handleProjectExport = () => {
    if (!store.cells || !store.source) return;
    const project = createProjectSnapshot({
      projectId: store.projectId,
      projectName: store.projectName,
      createdAt: store.createdAt,
      palette: store.palette,
      settings: store.settings,
      watermarkEnabled: store.watermarkEnabled,
      cells: store.cells,
      source: store.source,
    });
    downloadTextFile(serializeProject(project), `${safeFileStem(store.projectName)}.ptp.json`);
    setNotice('工程 JSON 已导出。');
  };

  const handlePatternExport = async () => {
    if (!store.cells) return;
    if (typeof OffscreenCanvas === 'undefined') {
      setError('当前浏览器不支持 OffscreenCanvas，请使用最新版桌面 Chrome 或 Edge。');
      return;
    }
    setError(null);
    setIsExporting(true);
    try {
      const fileStem = safeFileStem(store.projectName);
      const result = await exportPattern(
        {
          projectName: fileStem,
          grid: store.settings.grid,
          cells: store.cells,
          palette: store.palette,
          counts: store.counts,
          totalBeads: store.totalBeads,
          tileSize,
          watermarkEnabled: store.watermarkEnabled,
        },
        (message) =>
          setExportProgress({ label: message.stage, completed: message.completed, total: Math.max(1, message.total) }),
      );
      downloadBlob(result.master, `${fileStem}-master.png`);
      downloadBlob(result.archive, `${fileStem}-png.zip`);
      if (redinkBridge.current?.connected && handoffContext) {
        await redinkBridge.current.sendPattern(result.master, {
          columns: store.settings.grid.columns,
          rows: store.settings.grid.rows,
          usedColors: store.counts.length,
        });
        setNotice('母版 PNG 已回传 RedInk，等待确认后追加到原子主题末尾。');
      } else {
        setNotice('母版 PNG 与分块 ZIP 已生成。');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导出失败。');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="eyebrow">PERLER TO PERFECT</p>
          <h1>生产级拼豆图纸工作台</h1>
        </div>
        <div className="topbar-status">
          <span className="privacy-dot" /> 本地计算 · 图片不上传
        </div>
      </header>

      <main className="workspace">
        <aside className="left-panel panel">
          <section>
            <div className="section-heading">
              <span>01</span>
              <h2>原图与构图</h2>
            </div>
            <label className="file-drop">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleImageFile(file).catch((reason) => setError(reason instanceof Error ? reason.message : '图片导入失败。'));
                  event.currentTarget.value = '';
                }}
              />
              <strong>{sourceBlob ? '更换原图' : '导入原图'}</strong>
              <span>PNG / JPEG / WebP · ≤25MB</span>
            </label>
            {sourceUrl ? (
              <div className="source-preview">
                <img src={sourceUrl} alt="已导入的原图预览" />
                <span>
                  {store.source?.fileName}
                  {sourceDimensions ? ` · ${sourceDimensions.width}×${sourceDimensions.height}` : ''}
                </span>
              </div>
            ) : null}
            {sourceUrl && sourceDimensions ? (
              <CropPreview
                sourceUrl={sourceUrl}
                sourceDimensions={sourceDimensions}
                grid={store.settings.grid}
                transform={store.settings.transform}
                cropBox={store.settings.cropBox}
                onCommit={({ transform, cropBox }) => {
                  updateSetting({ transform, cropBox });
                  setNotice('裁切已确认，请点击“生成严格网格图纸”应用到图纸。');
                }}
                onCancel={() => setNotice('已取消本次裁切调整。')}
              />
            ) : null}
            <div className="field-row two-columns">
              <label>
                列数
                <input
                  type="number"
                  min="1"
                  max="300"
                  value={store.settings.grid.columns}
                  onChange={(event) =>
                    updateSetting({
                      grid: { ...store.settings.grid, columns: clampInteger(event.target.value, 1, 300) },
                    })
                  }
                />
              </label>
              <label>
                行数
                <input
                  type="number"
                  min="1"
                  max="300"
                  value={store.settings.grid.rows}
                  onChange={(event) =>
                    updateSetting({ grid: { ...store.settings.grid, rows: clampInteger(event.target.value, 1, 300) } })
                  }
                />
              </label>
            </div>
          </section>

          <section>
            <div className="section-heading">
              <span>02</span>
              <h2>颜色约束</h2>
            </div>
            <div className="palette-meta">
              <strong>{store.palette.edition}</strong>
              <span>{store.palette.colors.length} 个可用色号</span>
            </div>
            <label className={`detail-priority-toggle ${store.settings.detailPriority ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={store.settings.detailPriority}
                onChange={(event) => updateSetting({ detailPriority: event.target.checked })}
              />
              <span>
                <strong>细节优先</strong>
                <small>加强轮廓和高对比细节；低对比杂点仍会清理</small>
              </span>
            </label>
            <label className="field-stack">
              实际用色上限：{store.settings.maxUsedColors}（有收益才增加）
              <input
                type="range"
                min="2"
                max={Math.min(64, store.settings.enabledColorIds.length)}
                value={store.settings.maxUsedColors}
                onChange={(event) => updateSetting({ maxUsedColors: Number(event.target.value) })}
              />
            </label>
            <label className="field-stack">
              {store.settings.minimumPaletteDistance === 0
                ? '相近色合并：关闭'
                : `相近色合并：ΔE < ${store.settings.minimumPaletteDistance}`}
              <input
                type="range"
                min="0"
                max="12"
                step="1"
                value={store.settings.minimumPaletteDistance}
                onChange={(event) => updateSetting({ minimumPaletteDistance: Number(event.target.value) })}
              />
            </label>
            <label className="field-stack">
              低对比杂色清理：≤ {store.settings.cleanupRegionSize} 格
              <input
                type="range"
                min="0"
                max="4"
                value={store.settings.cleanupRegionSize}
                onChange={(event) =>
                  updateSetting({ cleanupRegionSize: Number(event.target.value) as 0 | 1 | 2 | 3 | 4 })
                }
              />
            </label>
            <p className="helper">用色数是上限，不会强制用满；相近色若覆盖足够大的真实区域仍可保留。</p>
            <label className="secondary-button file-button">
              导入自定义色板
              <input
                type="file"
                accept=".csv,.json,text/csv,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handlePaletteFile(file);
                  event.currentTarget.value = '';
                }}
              />
            </label>
            {store.palette.id !== MARD_STANDARD_221_PALETTE.id ? (
              <button type="button" className="secondary-button" onClick={() => store.setPalette(MARD_STANDARD_221_PALETTE)}>
                切换到 MARD 标准 221 色
              </button>
            ) : null}
            <p className="helper">CSV 表头：code, hex, name, series。色号限 1–4 位字母/数字/连字符。</p>
          </section>

          <button type="button" className="primary-button generate-button" disabled={!sourceBlob || isGenerating} onClick={() => void handleGenerate()}>
            {isGenerating ? '正在生成…' : store.cells ? '按当前参数重新生成' : '生成严格网格图纸'}
          </button>
          {isGenerating ? (
            <div className="progress-card">
              <div>
                <span>{generationProgress.label}</span>
                <span>{Math.round((generationProgress.completed / generationProgress.total) * 100)}%</span>
              </div>
              <progress value={generationProgress.completed} max={generationProgress.total} />
              <button type="button" className="text-button" onClick={() => generationTask.current?.cancel()}>
                取消任务
              </button>
            </div>
          ) : null}
        </aside>

        <section className="stage-panel panel">
          <div className="stage-toolbar">
            <div className="tool-group" aria-label="编辑工具">
              {(
                [
                  ['paint', '画笔'],
                  ['eyedropper', '吸色'],
                  ['wand', '魔棒'],
                  ['lasso', '圈选'],
                  ['erase', '橡皮'],
                  ['pan', '平移'],
                ] as const
              ).map(([value, label]) => (
                <button
                  type="button"
                  className={tool === value ? 'active' : ''}
                  disabled={!store.cells || previewMode}
                  key={value}
                  onClick={() => setTool(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="tool-group">
              <button type="button" disabled={previewMode || store.history.length === 0} onClick={store.undo}>
                撤销
              </button>
              <button type="button" disabled={previewMode || store.future.length === 0} onClick={store.redo}>
                重做
              </button>
            </div>
            <div className="tool-group preview-toggle-group" aria-label="图纸视图">
              <button
                type="button"
                className={previewMode ? 'active' : ''}
                disabled={!store.cells}
                aria-pressed={previewMode}
                onClick={() => setPreviewMode((current) => !current)}
              >
                {previewMode ? '返回编辑' : '最终效果'}
              </button>
            </div>
            <div className="stage-summary">
              <span>{store.settings.grid.columns}×{store.settings.grid.rows}</span>
              <span>{store.counts.length} 色</span>
              <strong>{store.totalBeads} 颗</strong>
            </div>
          </div>

          {store.cells ? (
            <>
              <PatternCanvas
                cells={store.cells}
                grid={store.settings.grid}
                palette={store.palette}
                tool={tool}
                selectedPaletteIndex={selectedPaletteIndex}
                backgroundPreview={store.backgroundPreview}
                previewMode={previewMode}
                watermarkEnabled={store.watermarkEnabled}
                onPaint={store.paintCells}
                onPickColor={handlePickColor}
                onMagicWand={handleMagicWand}
              />
              <div className="background-actions">
                {store.backgroundPreview.length === 0 ? (
                  <>
                    <button type="button" className="secondary-button" onClick={store.previewBorderBackground}>
                      预览边缘背景
                    </button>
                    <button type="button" className="danger-button" onClick={handleKeepLargestComponent}>
                      仅保留主体
                    </button>
                  </>
                ) : (
                  <>
                    <span>候选空格：{store.backgroundPreview.length}</span>
                    <button type="button" className="danger-button" onClick={store.applyBackgroundPreview}>
                      应用为空格
                    </button>
                    <button type="button" className="secondary-button" onClick={store.cancelBackgroundPreview}>
                      取消
                    </button>
                    <button type="button" className="danger-button" onClick={handleKeepLargestComponent}>
                      仅保留主体
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="empty-stage">
              <div className="empty-grid" aria-hidden="true">
                {Array.from({ length: 36 }, (_, index) => <span key={index} />)}
              </div>
              <p className="eyebrow">STRICT GRID · ONE CELL · ONE COLOR</p>
              <h2>从原图到可生产矩阵</h2>
              <p>设定精确行列数和颜色上限后生成。每个非空格只会对应一个有效色号。</p>
            </div>
          )}
        </section>

        <aside className="right-panel panel">
          <section>
            <div className="section-heading">
              <span>03</span>
              <h2>色号与数量</h2>
            </div>
            {selectedColor ? (
              <div className="selected-color-card">
                <span className="selected-swatch" style={{ backgroundColor: selectedColor.srgbHex }} />
                <div>
                  <strong>{selectedColor.code}</strong>
                  <span>{selectedColor.name ?? selectedColor.id}</span>
                </div>
                <em>{usedPaletteIndices.has(selectedPaletteIndex) ? '图中使用' : '可选色'}</em>
              </div>
            ) : null}
            <PalettePanel
              palette={store.palette}
              enabledColorIds={store.settings.enabledColorIds}
              lockedColorIds={store.settings.lockedColorIds}
              selectedPaletteIndex={selectedPaletteIndex}
              counts={store.counts}
              onSelect={setSelectedPaletteIndex}
              onToggleEnabled={toggleEnabledColor}
              onToggleLocked={toggleLockedColor}
            />
            <div className="palette-footer">
              <span>启用 {enabledSet.size}</span>
              <span>使用 {store.counts.length}</span>
              <span>空格 {store.cells ? store.cells.length - store.totalBeads : 0}</span>
            </div>
          </section>

          <section>
            <div className="section-heading">
              <span>04</span>
              <h2>工程与生产导出</h2>
            </div>
            <label className="field-stack">
              项目名称
              <input value={store.projectName} maxLength={80} onChange={(event) => store.setProjectName(event.target.value)} />
            </label>
            <div className="button-row">
              <button type="button" className="secondary-button" disabled={!store.cells} onClick={handleProjectExport}>
                导出工程 JSON
              </button>
              <label className="secondary-button file-button">
                导入工程
                <input
                  type="file"
                  accept=".json,.ptp.json,application/json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleProjectFile(file);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
            <label className="field-stack">
              分块格数
              <select value={tileSize} onChange={(event) => setTileSize(Number(event.target.value))}>
                <option value="29">29×29 实体板</option>
                <option value="50">50×50（默认）</option>
                <option value="75">75×75</option>
                <option value="100">100×100</option>
              </select>
            </label>
            <label className={`detail-priority-toggle ${store.watermarkEnabled ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={store.watermarkEnabled}
                onChange={(event) => store.setWatermarkEnabled(event.target.checked)}
              />
              <span>
                <strong>显示水印</strong>
                <small>编辑画布、最终效果和导出同步显示“8Bit像素画”</small>
              </span>
            </label>
            <button type="button" className="primary-button" disabled={!store.cells || isExporting} onClick={() => void handlePatternExport()}>
              {isExporting ? '正在导出…' : '导出母版 PNG + 分块 ZIP'}
            </button>
            {isExporting ? (
              <div className="progress-card compact">
                <div>
                  <span>{exportProgress.label}</span>
                  <span>{exportProgress.completed}/{exportProgress.total}</span>
                </div>
                <progress value={exportProgress.completed} max={exportProgress.total} />
              </div>
            ) : null}
          </section>
        </aside>
      </main>

      <footer className="statusbar">
        <span className={error ? 'status-error' : ''}>{error ?? notice}</span>
        <span>算法 v{ALGORITHM_VERSION} · {store.palette.source.label}</span>
      </footer>
    </div>
  );
}
