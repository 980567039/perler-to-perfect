import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent, WheelEvent } from 'react';
import { GENERATION_SAMPLE_SCALE } from '../domain/generation';
import type { CropBox, GenerationSettings, GridSize } from '../domain/types';

const PREVIEW_MAX_WIDTH = 258;
const PREVIEW_MAX_HEIGHT = 220;
const MIN_CROP_SCALE = 0.5;
const MAX_CROP_SCALE = 4;

type CropTransform = GenerationSettings['transform'];

interface CropPreviewProps {
  sourceUrl: string;
  sourceDimensions: { width: number; height: number };
  grid: GridSize;
  transform: CropTransform;
  cropBox?: CropBox;
  onCommit: (change: { transform: CropTransform; cropBox: CropBox | undefined }) => void;
  onCancel: () => void;
}

interface PreviewSize {
  width: number;
  height: number;
}

interface ImageLayout extends PreviewSize {
  left: number;
  top: number;
}

type HandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

const FULL_CROP_BOX: CropBox = { x: 0, y: 0, width: 1, height: 1 };

interface HandlePointerStart {
  pointerId: number;
  clientX: number;
  clientY: number;
  handle: HandleType;
  cropBox: CropBox;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sameTransform(first: CropTransform, second: CropTransform): boolean {
  return first.scale === second.scale && first.offsetX === second.offsetX && first.offsetY === second.offsetY;
}

function sameCropBox(first: CropBox, second: CropBox): boolean {
  return first.x === second.x && first.y === second.y && first.width === second.width && first.height === second.height;
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
): number {
  const widthScale = previewSize.width / sourceDimensions.width;
  const heightScale = previewSize.height / sourceDimensions.height;
  return Math.max(widthScale, heightScale);
}

function getImageLayout(
  sourceDimensions: { width: number; height: number },
  grid: GridSize,
  transform: CropTransform,
  previewSize: PreviewSize,
): ImageLayout {
  const baseScale = getBaseScale(sourceDimensions, previewSize);
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
  const layout = getImageLayout(sourceDimensions, grid, { ...transform, scale }, previewSize);
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

export function CropPreview({
  sourceUrl,
  sourceDimensions,
  grid,
  transform,
  cropBox,
  onCommit,
  onCancel,
}: CropPreviewProps) {
  const pointerStart = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    transform: CropTransform;
  } | null>(null);

  const handlePointerStart = useRef<HandlePointerStart | null>(null);
  const [draftTransform, setDraftTransform] = useState<CropTransform>(() => ({ ...transform }));
  const [draftCropBox, setDraftCropBox] = useState<CropBox>(() => ({ ...(cropBox ?? FULL_CROP_BOX) }));

  const previewSize = useMemo(() => getCropPreviewSize(grid), [grid.columns, grid.rows]);
  useEffect(() => {
    setDraftTransform({ ...transform });
    setDraftCropBox({ ...(cropBox ?? FULL_CROP_BOX) });
  }, [cropBox, transform]);

  const imageLayout = useMemo(
    () => getImageLayout(sourceDimensions, grid, draftTransform, previewSize),
    [draftTransform, grid, previewSize, sourceDimensions],
  );

  const effectiveCropBox: CropBox = useMemo(() => draftCropBox, [draftCropBox]);

  const hasDraftChanges = !sameTransform(draftTransform, transform) || !sameCropBox(draftCropBox, cropBox ?? FULL_CROP_BOX);

  const reset = () => {
    setDraftTransform({ scale: MIN_CROP_SCALE, offsetX: 0, offsetY: 0 });
    setDraftCropBox({ ...FULL_CROP_BOX });
  };

  const adjustScale = (delta: number) => {
    const next = clamp(
      (Number.isFinite(draftTransform.scale) ? draftTransform.scale : MIN_CROP_SCALE) + delta,
      MIN_CROP_SCALE,
      MAX_CROP_SCALE,
    );
    setDraftTransform(clampCropTransform(sourceDimensions, grid, { ...draftTransform, scale: next }, previewSize));
  };

  const handleHandlePointerDown = (handle: HandleType, event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    handlePointerStart.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      handle,
      cropBox: { ...effectiveCropBox },
    };
  };

  const handleHandlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = handlePointerStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.stopPropagation();

    const dx = (event.clientX - start.clientX) / previewSize.width;
    const dy = (event.clientY - start.clientY) / previewSize.height;

    let { x, y, width, height } = start.cropBox;
    const minSize = 0.05;

    switch (start.handle) {
      case 'nw': {
        const nx = clamp(x + dx, 0, x + width - minSize);
        const ny = clamp(y + dy, 0, y + height - minSize);
        width += x - nx;
        height += y - ny;
        x = nx;
        y = ny;
        break;
      }
      case 'n': {
        const ny = clamp(y + dy, 0, y + height - minSize);
        height += y - ny;
        y = ny;
        break;
      }
      case 'ne': {
        width = clamp(width + dx, minSize, 1 - x);
        const ny = clamp(y + dy, 0, y + height - minSize);
        height += y - ny;
        y = ny;
        break;
      }
      case 'e': {
        width = clamp(width + dx, minSize, 1 - x);
        break;
      }
      case 'se': {
        width = clamp(width + dx, minSize, 1 - x);
        height = clamp(height + dy, minSize, 1 - y);
        break;
      }
      case 's': {
        height = clamp(height + dy, minSize, 1 - y);
        break;
      }
      case 'sw': {
        const nx = clamp(x + dx, 0, x + width - minSize);
        width += x - nx;
        x = nx;
        height = clamp(height + dy, minSize, 1 - y);
        break;
      }
      case 'w': {
        const nx = clamp(x + dx, 0, x + width - minSize);
        width += x - nx;
        x = nx;
        break;
      }
      case 'move': {
        x = clamp(x + dx, 0, 1 - width);
        y = clamp(y + dy, 0, 1 - height);
        break;
      }
    }

    setDraftCropBox({ x, y, width, height });
  };

  const handleHandlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (handlePointerStart.current?.pointerId === event.pointerId) {
      handlePointerStart.current = null;
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStart.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      transform: { ...draftTransform },
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const offsetScaleX = previewSize.width / (grid.columns * GENERATION_SAMPLE_SCALE);
    const offsetScaleY = previewSize.height / (grid.rows * GENERATION_SAMPLE_SCALE);
    setDraftTransform(
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
    event.preventDefault();
    adjustScale(event.deltaY < 0 ? 0.1 : -0.1);
  };

  const commit = () => {
    if (!hasDraftChanges) return;
    onCommit({ transform: { ...draftTransform }, cropBox: { ...draftCropBox } });
  };

  const cancel = () => {
    setDraftTransform({ ...transform });
    setDraftCropBox({ ...(cropBox ?? FULL_CROP_BOX) });
    onCancel();
  };

  const cropOverlayStyle = useMemo(() => {
    const box = effectiveCropBox;
    return {
      left: `${box.x * 100}%`,
      top: `${box.y * 100}%`,
      width: `${box.width * 100}%`,
      height: `${box.height * 100}%`,
    };
  }, [effectiveCropBox]);

  return (
    <div className="crop-editor">
      <div className="crop-editor-heading">
        <strong>裁切取景</strong>
        <span>拖动边框手柄精细裁切</span>
      </div>
      <div
        className="crop-viewport is-cropping"
        style={{ width: previewSize.width, height: previewSize.height }}
        onDoubleClick={reset}
        onPointerCancel={releasePointer}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releasePointer}
        onWheel={handleWheel}
        role="img"
        aria-label="拖动边缘手柄或图片调整裁切范围"
      >
        <img
          src={sourceUrl}
          alt=""
          draggable={false}
          style={{ width: imageLayout.width, height: imageLayout.height, left: imageLayout.left, top: imageLayout.top }}
        />
        <div
          className="crop-box-overlay"
          style={cropOverlayStyle}
          onPointerDown={(e) => handleHandlePointerDown('move', e)}
          onPointerMove={handleHandlePointerMove}
          onPointerUp={handleHandlePointerUp}
          onPointerCancel={handleHandlePointerUp}
        >
          <div className="crop-box-line n" onPointerDown={(e) => handleHandlePointerDown('n', e)} onPointerMove={handleHandlePointerMove} onPointerUp={handleHandlePointerUp} />
          <div className="crop-box-line e" onPointerDown={(e) => handleHandlePointerDown('e', e)} onPointerMove={handleHandlePointerMove} onPointerUp={handleHandlePointerUp} />
          <div className="crop-box-line s" onPointerDown={(e) => handleHandlePointerDown('s', e)} onPointerMove={handleHandlePointerMove} onPointerUp={handleHandlePointerUp} />
          <div className="crop-box-line w" onPointerDown={(e) => handleHandlePointerDown('w', e)} onPointerMove={handleHandlePointerMove} onPointerUp={handleHandlePointerUp} />

          <div className="crop-box-handle nw" onPointerDown={(e) => handleHandlePointerDown('nw', e)} onPointerMove={handleHandlePointerMove} onPointerUp={handleHandlePointerUp} />
          <div className="crop-box-handle ne" onPointerDown={(e) => handleHandlePointerDown('ne', e)} onPointerMove={handleHandlePointerMove} onPointerUp={handleHandlePointerUp} />
          <div className="crop-box-handle se" onPointerDown={(e) => handleHandlePointerDown('se', e)} onPointerMove={handleHandlePointerMove} onPointerUp={handleHandlePointerUp} />
          <div className="crop-box-handle sw" onPointerDown={(e) => handleHandlePointerDown('sw', e)} onPointerMove={handleHandlePointerMove} onPointerUp={handleHandlePointerUp} />
        </div>
      </div>
      <div className="crop-editor-controls">
        <span>{`缩放 ${draftTransform.scale.toFixed(1)}×`}</span>
        <button type="button" onClick={() => adjustScale(-0.1)} aria-label="缩小裁切范围">
          −
        </button>
        <button type="button" onClick={() => adjustScale(0.1)} aria-label="放大裁切范围">
          +
        </button>
        <button type="button" className="crop-reset" onClick={reset}>
          重置
        </button>
        <button type="button" className="crop-commit" disabled={!hasDraftChanges} onClick={commit}>
          确定裁切
        </button>
        <button type="button" className="crop-cancel" disabled={!hasDraftChanges} onClick={cancel}>
          取消
        </button>
      </div>
      <p className="crop-helper">
        拖动边框/四角手柄调整裁切边缘，拖动图片平移，滚轮或 ± 调整缩放；完成后点击“确定裁切”。
      </p>
    </div>
  );
}
