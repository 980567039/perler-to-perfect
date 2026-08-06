export interface WatermarkBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  cellPixels: number;
}

type WatermarkContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function drawWatermark(context: WatermarkContext, bounds: WatermarkBounds): void {
  const { left, top, right, bottom, cellPixels } = bounds;
  const width = right - left;
  const height = bottom - top;
  const fontSize = Math.max(22, Math.min(48, Math.round(cellPixels * 1.8)));
  const repeatColumns = Math.max(1, Math.min(3, Math.ceil(width / cellPixels / 36)));
  const repeatRows = Math.max(1, Math.min(3, Math.ceil(height / cellPixels / 36)));

  context.save();
  context.globalAlpha = 0.07;
  context.fillStyle = '#475569';
  context.font = `700 ${fontSize}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  for (let row = 0; row < repeatRows; row += 1) {
    for (let column = 0; column < repeatColumns; column += 1) {
      context.save();
      context.translate(
        left + (column + 0.5) * (width / repeatColumns),
        top + (row + 0.5) * (height / repeatRows),
      );
      context.rotate(-Math.PI / 18);
      context.fillText('8Bit像素画', 0, 0);
      context.restore();
    }
  }

  context.restore();
}
