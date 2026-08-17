import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_CELL, type GridSize, type PaletteManifest, type PatternVisualMode } from '../domain/types';
import { drawPatternVisual } from '../rendering/patternDrawing';
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
  visualMode: PatternVisualMode;
  showGridOverlay: boolean;
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
  visualMode,
  showGridOverlay,
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

  const fit = useCallback((overview = false) => {
    const padding = visualMode === 'grid' ? 56 : 32;
    const fitScale = Math.max(
      1,
      Math.min(24, Math.min((size.width - padding * 2) / grid.columns, (size.height - padding * 2) / grid.rows)),
    );
    // A full 1–N ruler and three-character bead codes cannot be read at the
    // 4–5px overview scale of a 104×104 board. Enter the grid view at a
    // production-friendly inspection scale; the explicit fit button remains
    // available for the whole-board overview.
    const scale = visualMode === 'grid' && !overview ? Math.min(24, Math.max(18, fitScale)) : fitScale;
    setViewport({
      scale,
      offsetX: (size.width - grid.columns * scale) / 2,
      offsetY: (size.height - grid.rows * scale) / 2,
    });
  }, [grid.columns, grid.rows, size.height, size.width, visualMode]);

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
    // Keep the viewport margin in the same deep charcoal family as the editor.
    // Grid mode still paints its own white production sheet inside the renderer.
    context.fillStyle = '#0F1318';
    context.fillRect(0, 0, size.width, size.height);

    const { scale, offsetX, offsetY } = viewport;
    const startColumn = Math.max(0, Math.floor(-offsetX / scale));
    const endColumn = Math.min(grid.columns, Math.ceil((size.width - offsetX) / scale));
    const startRow = Math.max(0, Math.floor(-offsetY / scale));
    const endRow = Math.min(grid.rows, Math.ceil((size.height - offsetY) / scale));

    context.save();
    context.translate(offsetX + startColumn * scale, offsetY + startRow * scale);
    drawPatternVisual(context, {
      cells,
      fullGrid: grid,
      palette,
      startRow,
      startColumn,
      rows: Math.max(0, endRow - startRow),
      columns: Math.max(0, endColumn - startColumn),
      cellPixels: scale,
      visualMode,
      showGridOverlay,
      watermarkEnabled: false,
      showCoordinates: false,
      includeAxes: false,
    });
    context.restore();

    if (watermarkEnabled) {
      drawWatermark(context, {
        left: offsetX,
        top: offsetY,
        right: offsetX + grid.columns * scale,
        bottom: offsetY + grid.rows * scale,
        cellPixels: scale,
      });
    }

    for (let row = startRow; row < endRow; row += 1) {
      for (let column = startColumn; column < endColumn; column += 1) {
        const index = row * grid.columns + column;
        if (!previewSet.has(index)) continue;
        context.fillStyle = 'rgba(220, 38, 38, 0.48)';
        context.fillRect(offsetX + column * scale, offsetY + row * scale, scale, scale);
      }
    }

    if (visualMode === 'grid') {
      const axisFontSize = scale >= 12 ? Math.min(13, Math.max(9, Math.floor(scale * 0.5))) : Math.max(6, Math.floor(scale * 0.38));
      context.font = `600 ${axisFontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      context.fillStyle = '#4B5563';
      context.textBaseline = 'middle';
      context.textAlign = 'center';
      const topLabelY = Math.max(7, Math.min(size.height - 7, offsetY - 9));
      for (let column = startColumn; column < endColumn; column += 1) {
        context.fillText(String(column + 1), offsetX + (column + 0.5) * scale, topLabelY);
      }
      const leftLabelX = Math.max(22, Math.min(size.width - 7, offsetX - 9));
      context.textAlign = 'right';
      for (let row = startRow; row < endRow; row += 1) {
        context.fillText(String(row + 1), leftLabelX, offsetY + (row + 0.5) * scale);
      }
    }

    if (lassoPath.length > 1) {
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
  }, [cells, grid, lassoPath, palette, previewSet, showGridOverlay, size, viewport, visualMode, watermarkEnabled]);

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
    const mode: EditorTool = event.button === 1 || event.button === 2 ? 'pan' : tool;
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
    <div className={`canvas-shell visual-${visualMode}`} ref={containerRef}>
      <canvas
        ref={canvasRef}
        aria-label={`${visualMode === 'beads' ? '拼豆实物' : visualMode === 'ironed' ? '熨烫成品' : '方格图纸'}画布，${grid.columns} 列 ${grid.rows} 行`}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setCursorCell(null)}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      />
      <div className="canvas-hud">
        <button type="button" className="small-button" onClick={() => fit(true)}>
          适合窗口
        </button>
        <span>{Math.round(viewport.scale * 10) / 10}px/格</span>
        {cursorCell ? <span>行 {cursorCell.row + 1} · 列 {cursorCell.column + 1}</span> : null}
      </div>
    </div>
  );
}
