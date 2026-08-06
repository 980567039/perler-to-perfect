import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { contrastTextColor } from '../domain/color';
import { EMPTY_CELL, type GridSize, type PaletteManifest } from '../domain/types';
import { drawWatermark } from '../rendering/watermark';

export type EditorTool = 'paint' | 'eyedropper' | 'wand' | 'lasso' | 'erase' | 'pan';

interface CanvasPoint {
  x: number;
  y: number;
}

interface PatternCanvasProps {
  cells: Uint16Array;
  grid: GridSize;
  palette: PaletteManifest;
  tool: EditorTool;
  selectedPaletteIndex: number;
  backgroundPreview: number[];
  previewMode: boolean;
  watermarkEnabled: boolean;
  onPaint: (indices: number[], value: number) => void;
  onPickColor: (paletteIndex: number | null) => void;
  onMagicWand: (index: number) => void;
}

interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function PatternCanvas({
  cells,
  grid,
  palette,
  tool,
  selectedPaletteIndex,
  backgroundPreview,
  previewMode,
  watermarkEnabled,
  onPaint,
  onPickColor,
  onMagicWand,
}: PatternCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 800, height: 620 });
  const [viewport, setViewport] = useState<Viewport>({ scale: 10, offsetX: 0, offsetY: 0 });
  const [cursorCell, setCursorCell] = useState<{ row: number; column: number } | null>(null);
  const dragRef = useRef<{
    mode: EditorTool;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    indices: Set<number>;
    path: CanvasPoint[];
  } | null>(null);
  const previewSet = useMemo(() => new Set(backgroundPreview), [backgroundPreview]);
  const [lassoPath, setLassoPath] = useState<CanvasPoint[]>([]);

  const fit = useCallback(() => {
    const padding = 32;
    const scale = Math.max(
      1,
      Math.min(24, Math.min((size.width - padding * 2) / grid.columns, (size.height - padding * 2) / grid.rows)),
    );
    setViewport({
      scale,
      offsetX: (size.width - grid.columns * scale) / 2,
      offsetY: (size.height - grid.rows * scale) / 2,
    });
  }, [grid.columns, grid.rows, size.height, size.width]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => fit(), [fit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = '#ECE8E1';
    context.fillRect(0, 0, size.width, size.height);

    const { scale, offsetX, offsetY } = viewport;
    const startColumn = Math.max(0, Math.floor(-offsetX / scale));
    const endColumn = Math.min(grid.columns, Math.ceil((size.width - offsetX) / scale));
    const startRow = Math.max(0, Math.floor(-offsetY / scale));
    const endRow = Math.min(grid.rows, Math.ceil((size.height - offsetY) / scale));

    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (let row = startRow; row < endRow; row += 1) {
      for (let column = startColumn; column < endColumn; column += 1) {
        const index = row * grid.columns + column;
        const value = cells[index] ?? EMPTY_CELL;
        const x = offsetX + column * scale;
        const y = offsetY + row * scale;
        if (value === EMPTY_CELL) {
          context.fillStyle = (row + column) % 2 === 0 ? '#FFFFFF' : '#F7F5F1';
        } else {
          context.fillStyle = palette.colors[value]?.srgbHex ?? '#FF00FF';
        }
        context.fillRect(x, y, scale, scale);
        if (previewSet.has(index)) {
          context.fillStyle = 'rgba(220, 38, 38, 0.48)';
          context.fillRect(x, y, scale, scale);
        }
        if (!previewMode && value !== EMPTY_CELL && scale >= 18) {
          const color = palette.colors[value];
          if (color) {
            const fontSize = Math.max(7, Math.min(12, Math.floor(scale * 0.38)));
            context.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
            context.fillStyle = contrastTextColor(color.srgbHex);
            context.save();
            context.beginPath();
            context.rect(x + 1, y + 1, scale - 2, scale - 2);
            context.clip();
            context.fillText(color.code, x + scale / 2, y + scale / 2);
            context.restore();
          }
        }
      }
    }

    if (watermarkEnabled) {
      drawWatermark(context, {
        left: offsetX,
        top: offsetY,
        right: offsetX + grid.columns * scale,
        bottom: offsetY + grid.rows * scale,
        cellPixels: scale,
      });
    }

    if (!previewMode) {
      context.strokeStyle = 'rgba(55, 65, 81, 0.22)';
      context.lineWidth = 1;
      context.beginPath();
      for (let column = startColumn; column <= endColumn; column += 1) {
        const x = Math.round(offsetX + column * scale) + 0.5;
        context.moveTo(x, Math.max(0, offsetY + startRow * scale));
        context.lineTo(x, Math.min(size.height, offsetY + endRow * scale));
      }
      for (let row = startRow; row <= endRow; row += 1) {
        const y = Math.round(offsetY + row * scale) + 0.5;
        context.moveTo(Math.max(0, offsetX + startColumn * scale), y);
        context.lineTo(Math.min(size.width, offsetX + endColumn * scale), y);
      }
      context.stroke();

      context.strokeStyle = 'rgba(220, 38, 38, 0.75)';
      context.lineWidth = 1.5;
      context.beginPath();
      for (let column = Math.max(10, Math.ceil(startColumn / 10) * 10); column < endColumn; column += 10) {
        const x = offsetX + column * scale;
        context.moveTo(x, Math.max(0, offsetY));
        context.lineTo(x, Math.min(size.height, offsetY + grid.rows * scale));
      }
      for (let row = Math.max(10, Math.ceil(startRow / 10) * 10); row < endRow; row += 10) {
        const y = offsetY + row * scale;
        context.moveTo(Math.max(0, offsetX), y);
        context.lineTo(Math.min(size.width, offsetX + grid.columns * scale), y);
      }
      context.stroke();

      context.strokeStyle = '#111827';
      context.lineWidth = 2;
      context.strokeRect(offsetX, offsetY, grid.columns * scale, grid.rows * scale);

      // Keep the coordinate helpers readable at the default 104×104 view.
      // As the user zooms in, progressively finer labels become available.
      const labelStep = scale >= 18 ? 1 : scale >= 8 ? 5 : 10;
      const shouldLabel = (value: number, maximum: number) =>
        value === 1 ||
        value === maximum ||
        (value % labelStep === 0 && (labelStep === 1 || maximum - value >= labelStep / 2));
      const axisFontSize = Math.max(9, Math.min(12, scale >= 18 ? Math.floor(scale * 0.38) : 10));
      context.font = `600 ${axisFontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      context.fillStyle = '#4B5563';
      context.textBaseline = 'middle';

      const topLabelY = Math.max(8, Math.min(size.height - 8, offsetY - 9));
      context.textAlign = 'center';
      for (let column = startColumn; column < endColumn; column += 1) {
        const label = column + 1;
        if (!shouldLabel(label, grid.columns)) continue;
        context.fillText(label.toString(), offsetX + (column + 0.5) * scale, topLabelY);
      }

      const leftLabelX = Math.max(28, Math.min(size.width - 8, offsetX - 9));
      context.textAlign = 'right';
      for (let row = startRow; row < endRow; row += 1) {
        const label = row + 1;
        if (!shouldLabel(label, grid.rows)) continue;
        context.fillText(label.toString(), leftLabelX, offsetY + (row + 0.5) * scale);
      }
    }

    if (!previewMode && lassoPath.length > 1) {
      context.save();
      context.strokeStyle = '#2563EB';
      context.fillStyle = 'rgba(37, 99, 235, 0.12)';
      context.lineWidth = 2;
      context.setLineDash([7, 5]);
      context.beginPath();
      context.moveTo(lassoPath[0]?.x ?? 0, lassoPath[0]?.y ?? 0);
      lassoPath.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.closePath();
      context.stroke();
      context.fill();
      context.restore();
    }
  }, [backgroundPreview, cells, grid, lassoPath, palette.colors, previewMode, previewSet, size, viewport, watermarkEnabled]);

  const eventCell = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const column = Math.floor((x - viewport.offsetX) / viewport.scale);
    const row = Math.floor((y - viewport.offsetY) / viewport.scale);
    if (column < 0 || column >= grid.columns || row < 0 || row >= grid.rows) return null;
    return { row, column, index: row * grid.columns + column };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const mode: EditorTool = previewMode || event.button === 1 || event.button === 2 ? 'pan' : tool;
    const cell = eventCell(event);
    if (mode === 'eyedropper') {
      const value = cell ? cells[cell.index] ?? EMPTY_CELL : EMPTY_CELL;
      onPickColor(value === EMPTY_CELL || value < 0 || value >= palette.colors.length ? null : value);
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (mode === 'wand') {
      if (cell) onMagicWand(cell.index);
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setLassoPath(mode === 'lasso' ? [point] : []);
    dragRef.current = {
      mode,
      startX: event.clientX - rect.left,
      startY: event.clientY - rect.top,
      originX: viewport.offsetX,
      originY: viewport.offsetY,
      indices: new Set(cell && mode !== 'pan' ? [cell.index] : []),
      path: mode === 'lasso' ? [point] : [],
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const cell = eventCell(event);
    setCursorCell(cell ? { row: cell.row, column: cell.column } : null);
    const drag = dragRef.current;
    if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (drag.mode === 'pan') {
      setViewport((current) => ({
        ...current,
        offsetX: drag.originX + (event.clientX - rect.left - drag.startX),
        offsetY: drag.originY + (event.clientY - rect.top - drag.startY),
      }));
    } else if (drag.mode === 'lasso') {
      drag.path.push({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      setLassoPath([...drag.path]);
    } else if (cell) {
      drag.indices.add(cell.index);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.mode === 'lasso' && drag.path.length >= 3) {
      const selected = new Set<number>();
      for (let row = 0; row < grid.rows; row += 1) {
        for (let column = 0; column < grid.columns; column += 1) {
          const point = { x: viewport.offsetX + (column + 0.5) * viewport.scale, y: viewport.offsetY + (row + 0.5) * viewport.scale };
          let inside = false;
          for (let index = 0, previous = drag.path.length - 1; index < drag.path.length; previous = index++) {
            const currentPoint = drag.path[index];
            const previousPoint = drag.path[previous];
            if (!currentPoint || !previousPoint) continue;
            const intersects =
              currentPoint.y > point.y !== previousPoint.y > point.y &&
              point.x <
                ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
                  (previousPoint.y - currentPoint.y) +
                  currentPoint.x;
            if (intersects) inside = !inside;
          }
          if (inside) selected.add(row * grid.columns + column);
        }
      }
      if (selected.size > 0) onPaint([...selected], EMPTY_CELL);
    } else if (drag.mode !== 'lasso' && drag.mode !== 'pan' && drag.indices.size > 0) {
      onPaint([...drag.indices], drag.mode === 'erase' ? EMPTY_CELL : selectedPaletteIndex);
    }
    setLassoPath([]);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const gridX = (pointerX - viewport.offsetX) / viewport.scale;
    const gridY = (pointerY - viewport.offsetY) / viewport.scale;
    const nextScale = Math.max(1, Math.min(48, viewport.scale * (event.deltaY < 0 ? 1.16 : 1 / 1.16)));
    setViewport({
      scale: nextScale,
      offsetX: pointerX - gridX * nextScale,
      offsetY: pointerY - gridY * nextScale,
    });
  };

  return (
    <div className={`canvas-shell ${previewMode ? 'is-preview' : ''}`} ref={containerRef}>
      <canvas
        ref={canvasRef}
        aria-label={`拼豆图纸画布，${grid.columns} 列 ${grid.rows} 行`}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setCursorCell(null)}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      />
      <div className="canvas-hud">
        <button type="button" className="small-button" onClick={fit}>
          适合窗口
        </button>
        <span>{Math.round(viewport.scale * 10) / 10}px/格</span>
        {cursorCell ? <span>行 {cursorCell.row + 1} · 列 {cursorCell.column + 1}</span> : null}
      </div>
    </div>
  );
}
