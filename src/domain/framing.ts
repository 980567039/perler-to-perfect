export interface FittedFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Fits a source rectangle into a target frame without changing its aspect ratio.
 * Any unused target area is left for the caller to fill as a background.
 */
export function fitWithinFrame(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): FittedFrame {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    left: (targetWidth - width) / 2,
    top: (targetHeight - height) / 2,
    width,
    height,
  };
}
