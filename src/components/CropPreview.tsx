import { useMemo, useRef } from 'react';
import type { PointerEvent, WheelEvent } from 'react';
import { GENERATION_SAMPLE_SCALE } from '../domain/generation';
import type { GenerationSettings, GridSize } from '../domain/types';

const PREVIEW_MAX_WIDTH = 258;
const PREVIEW_MAX_HEIGHT = 220;
const MIN_CROP_SCALE = 1;
const MAX_CROP_SCALE = 4;

type CropTransform = GenerationSettings['transform'];

interface CropPreviewProps {
  sourceUrl: string;
  sourceDimensions: { width: number; height: number };
  grid: GridSize;
  fit: GenerationSettings['fit'];
  transform: CropTransform;
  onChange: (transform: CropTransform) => void;
}

interface PreviewSize {
  width: number;
  height: number;
}

interface ImageLayout extends PreviewSize {
  left: number;
  top: number;
}

interface PointerStart {
  pointerId: number;
  clientX: number;
  clientY: number;
  transform: CropTransform;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getCropPreviewSize(grid: GridSize): PreviewSize {
  const aspectRatio = Math.max(0.01, grid.columns / Math.max(1, grid.rows));
  const width = Math.min(PREVIEW_MAX_WIDTH, PREVIEW_MAX_HEIGHT * aspectRatio);
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(width / aspectRatio)),
  };
}

function getBaseScale(
  sourceDimensions: { width: number; height: number },
  previewSize: PreviewSize,
  fit: GenerationSettings['fit'],
): number {
  const widthScale = previewSize.width / sourceDimensions.width;
  const heightScale = previewSize.height / sourceDimensions.height;
  return fit === 'contain' ? Math.min(widthScale, heightScale) : Math.max(widthScale, heightScale);
}

function getImageLayout(
  sourceDimensions: { width: number; height: number },
  grid: GridSize,
  fit: GenerationSettings['fit'],
  transform: CropTransform,
  previewSize: PreviewSize,
): ImageLayout {
  const baseScale = getBaseScale(sourceDimensions, previewSize, fit);
  const scale = baseScale * Math.max(0.05, transform.scale);
  const width = sourceDimensions.width * scale;
  const height = sourceDimensions.height * scale;
  const offsetScaleX = previewSize.width / (grid.columns * GENERATION_SAMPLE_SCALE);
  const offsetScaleY = previewSize.height / (grid.rows * GENERATION_SAMPLE_SCALE);

  return {
    width,
    height,
    left: (previewSize.width - width) / 2 + transform.offsetX * offsetScaleX,
    top: (previewSize.height - height) / 2 + transform.offsetY * offsetScaleY,
  };
}

export function clampCropTransform(
  sourceDimensions: { width: number; height: number },
  grid: GridSize,
  transform: CropTransform,
  previewSize = getCropPreviewSize(grid),
): CropTransform {
  const scale = clamp(Number.isFinite(transform.scale) ? transform.scale : MIN_CROP_SCALE, MIN_CROP_SCALE, MAX_CROP_SCALE);
  const layout = getImageLayout(sourceDimensions, grid, 'crop', { ...transform, scale }, previewSize);
  const offsetScaleX = previewSize.width / (grid.columns * GENERATION_SAMPLE_SCALE);
  const offsetScaleY = previewSize.height / (grid.rows * GENERATION_SAMPLE_SCALE);
  const maxOffsetX = Math.max(0, (layout.width - previewSize.width) / 2 / offsetScaleX);
  const maxOffsetY = Math.max(0, (layout.height - previewSize.height) / 2 / offsetScaleY);

  return {
    scale,
    offsetX: clamp(Number.isFinite(transform.offsetX) ? transform.offsetX : 0, -maxOffsetX, maxOffsetX),
    offsetY: clamp(Number.isFinite(transform.offsetY) ? transform.offsetY : 0, -maxOffsetY, maxOffsetY),
  };
}

export function CropPreview({ sourceUrl, sourceDimensions, grid, fit, transform, onChange }: CropPreviewProps) {
  const pointerStart = useRef<PointerStart | null>(null);
  const previewSize = useMemo(() => getCropPreviewSize(grid), [grid.columns, grid.rows]);
  const imageLayout = useMemo(
    () => getImageLayout(sourceDimensions, grid, fit, transform, previewSize),
    [fit, grid, previewSize, sourceDimensions, transform],
  );
  const cropEnabled = fit === 'crop';

  const reset = () => onChange({ scale: MIN_CROP_SCALE, offsetX: 0, offsetY: 0 });

  const adjustScale = (delta: number) => {
    const next = clamp((Number.isFinite(transform.scale) ? transform.scale : MIN_CROP_SCALE) + delta, MIN_CROP_SCALE, MAX_CROP_SCALE);
    onChange(clampCropTransform(sourceDimensions, grid, { ...transform, scale: next }, previewSize));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!cropEnabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStart.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      transform: { ...transform },
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const offsetScaleX = previewSize.width / (grid.columns * GENERATION_SAMPLE_SCALE);
    const offsetScaleY = previewSize.height / (grid.rows * GENERATION_SAMPLE_SCALE);
    onChange(
      clampCropTransform(
        sourceDimensions,
        grid,
        {
          ...start.transform,
          offsetX: start.transform.offsetX + (event.clientX - start.clientX) / offsetScaleX,
          offsetY: start.transform.offsetY + (event.clientY - start.clientY) / offsetScaleY,
        },
        previewSize,
      ),
    );
  };

  const releasePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerStart.current?.pointerId === event.pointerId) pointerStart.current = null;
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!cropEnabled) return;
    event.preventDefault();
    adjustScale(event.deltaY < 0 ? 0.1 : -0.1);
  };

  return (
    <div className="crop-editor">
      <div className="crop-editor-heading">
        <strong>裁切取景</strong>
        <span>{cropEnabled ? '拖动图片调整范围' : '切换到居中裁切后可调整'}</span>
      </div>
      <div
        className={`crop-viewport ${cropEnabled ? 'is-cropping' : 'is-contained'}`}
        style={{ width: previewSize.width, height: previewSize.height }}
        onDoubleClick={cropEnabled ? reset : undefined}
        onPointerCancel={releasePointer}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releasePointer}
        onWheel={handleWheel}
        role="img"
        aria-label={cropEnabled ? '拖动或滚动调整裁切取景' : '原图适配预览'}
      >
        <img
          src={sourceUrl}
          alt=""
          draggable={false}
          style={{ width: imageLayout.width, height: imageLayout.height, left: imageLayout.left, top: imageLayout.top }}
        />
        <span className="crop-guide" aria-hidden="true" />
      </div>
      <div className="crop-editor-controls">
        <span>{cropEnabled ? `缩放 ${transform.scale.toFixed(1)}×` : '完整放入'}</span>
        <button type="button" disabled={!cropEnabled} onClick={() => adjustScale(-0.1)} aria-label="缩小裁切范围">
          −
        </button>
        <button type="button" disabled={!cropEnabled} onClick={() => adjustScale(0.1)} aria-label="放大裁切范围">
          +
        </button>
        <button type="button" className="crop-reset" onClick={reset} disabled={!cropEnabled}>
          重置
        </button>
      </div>
      <p className="crop-helper">{cropEnabled ? '拖动图片移动取景，滚轮或 ± 调整缩放；双击可重置。' : '选择“居中裁切 · 不变形”后，可把主体移入网格并裁掉边缘内容。'}</p>
    </div>
  );
}
