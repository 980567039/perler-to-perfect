import { fitWithinFrame } from '../domain/framing';
import type { CropBox, GenerationSettings } from '../domain/types';

type SourceOverlayContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface SourceOverlayImageOptions {
  image: CanvasImageSource;
  imageWidth: number;
  imageHeight: number;
  targetWidth: number;
  targetHeight: number;
  fit: GenerationSettings['fit'];
  transform: GenerationSettings['transform'];
  cropBox?: CropBox;
  opacity: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Draws the same framed source image used by generation, in grid-local pixels. */
export function drawSourceOverlay(
  context: SourceOverlayContext,
  options: SourceOverlayImageOptions,
): void {
  const {
    image,
    imageWidth,
    imageHeight,
    targetWidth,
    targetHeight,
    fit,
    transform,
    cropBox,
  } = options;
  if (imageWidth < 1 || imageHeight < 1 || targetWidth < 1 || targetHeight < 1) return;

  context.save();
  context.globalAlpha = clamp(options.opacity, 0, 1);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.beginPath();
  context.rect(0, 0, targetWidth, targetHeight);
  context.clip();

  if (cropBox && fit === 'crop') {
    const baseScale = Math.max(targetWidth / imageWidth, targetHeight / imageHeight);
    const scale = baseScale * Math.max(0.05, transform.scale);
    const drawWidth = imageWidth * scale;
    const drawHeight = imageHeight * scale;
    const drawX = (targetWidth - drawWidth) / 2 + transform.offsetX;
    const drawY = (targetHeight - drawHeight) / 2 + transform.offsetY;
    const sourceX = (cropBox.x * targetWidth - drawX) / scale;
    const sourceY = (cropBox.y * targetHeight - drawY) / scale;
    const sourceWidth = (cropBox.width * targetWidth) / scale;
    const sourceHeight = (cropBox.height * targetHeight) / scale;
    const sourceLeft = clamp(sourceX, 0, imageWidth);
    const sourceTop = clamp(sourceY, 0, imageHeight);
    const sourceRight = clamp(sourceX + sourceWidth, 0, imageWidth);
    const sourceBottom = clamp(sourceY + sourceHeight, 0, imageHeight);
    const sourceCropWidth = Math.max(1, sourceRight - sourceLeft);
    const sourceCropHeight = Math.max(1, sourceBottom - sourceTop);
    const target = fitWithinFrame(sourceCropWidth, sourceCropHeight, targetWidth, targetHeight);
    context.drawImage(
      image,
      sourceLeft,
      sourceTop,
      sourceCropWidth,
      sourceCropHeight,
      target.left,
      target.top,
      target.width,
      target.height,
    );
  } else {
    const baseScale = fit === 'contain'
      ? Math.min(targetWidth / imageWidth, targetHeight / imageHeight)
      : Math.max(targetWidth / imageWidth, targetHeight / imageHeight);
    const scale = baseScale * Math.max(0.05, transform.scale);
    context.drawImage(
      image,
      (targetWidth - imageWidth * scale) / 2 + transform.offsetX,
      (targetHeight - imageHeight * scale) / 2 + transform.offsetY,
      imageWidth * scale,
      imageHeight * scale,
    );
  }
  context.restore();
}

