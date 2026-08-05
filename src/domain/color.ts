import type { LabColor, RgbColor } from './types';

const referenceWhite = { x: 0.95047, y: 1, z: 1.08883 };

export function normalizeHex(hex: string): `#${string}` {
  const value = hex.trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(value)) {
    throw new Error(`非法 HEX 颜色：${hex}`);
  }
  return value as `#${string}`;
}

export function hexToRgb(hex: string): RgbColor {
  const normalized = normalizeHex(hex);
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function srgbToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function xyzPivot(value: number): number {
  const delta = 6 / 29;
  return value > delta ** 3 ? Math.cbrt(value) : value / (3 * delta ** 2) + 4 / 29;
}

export function rgbToLab(rgb: RgbColor): LabColor {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);

  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / referenceWhite.x;
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / referenceWhite.y;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / referenceWhite.z;

  const fx = xyzPivot(x);
  const fy = xyzPivot(y);
  const fz = xyzPivot(z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function hexToLab(hex: string): LabColor {
  return rgbToLab(hexToRgb(hex));
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function hueAngleDegrees(b: number, aPrime: number): number {
  if (aPrime === 0 && b === 0) return 0;
  const angle = radiansToDegrees(Math.atan2(b, aPrime));
  return angle >= 0 ? angle : angle + 360;
}

/** CIEDE2000 with kL = kC = kH = 1. */
export function deltaE2000(first: LabColor, second: LabColor): number {
  const c1 = Math.hypot(first.a, first.b);
  const c2 = Math.hypot(second.a, second.b);
  const meanC = (c1 + c2) / 2;
  const meanC7 = meanC ** 7;
  const g = 0.5 * (1 - Math.sqrt(meanC7 / (meanC7 + 25 ** 7)));

  const a1Prime = (1 + g) * first.a;
  const a2Prime = (1 + g) * second.a;
  const c1Prime = Math.hypot(a1Prime, first.b);
  const c2Prime = Math.hypot(a2Prime, second.b);
  const h1Prime = hueAngleDegrees(first.b, a1Prime);
  const h2Prime = hueAngleDegrees(second.b, a2Prime);

  const deltaLPrime = second.l - first.l;
  const deltaCPrime = c2Prime - c1Prime;

  let deltaHue = h2Prime - h1Prime;
  if (c1Prime * c2Prime === 0) {
    deltaHue = 0;
  } else if (deltaHue > 180) {
    deltaHue -= 360;
  } else if (deltaHue < -180) {
    deltaHue += 360;
  }

  const deltaHPrime = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin(degreesToRadians(deltaHue / 2));
  const meanLPrime = (first.l + second.l) / 2;
  const meanCPrime = (c1Prime + c2Prime) / 2;

  let meanHPrime = h1Prime + h2Prime;
  if (c1Prime * c2Prime === 0) {
    meanHPrime = h1Prime + h2Prime;
  } else if (Math.abs(h1Prime - h2Prime) <= 180) {
    meanHPrime /= 2;
  } else if (h1Prime + h2Prime < 360) {
    meanHPrime = (h1Prime + h2Prime + 360) / 2;
  } else {
    meanHPrime = (h1Prime + h2Prime - 360) / 2;
  }

  const t =
    1 -
    0.17 * Math.cos(degreesToRadians(meanHPrime - 30)) +
    0.24 * Math.cos(degreesToRadians(2 * meanHPrime)) +
    0.32 * Math.cos(degreesToRadians(3 * meanHPrime + 6)) -
    0.2 * Math.cos(degreesToRadians(4 * meanHPrime - 63));

  const deltaTheta = 30 * Math.exp(-(((meanHPrime - 275) / 25) ** 2));
  const meanCPrime7 = meanCPrime ** 7;
  const rC = 2 * Math.sqrt(meanCPrime7 / (meanCPrime7 + 25 ** 7));
  const sL = 1 + (0.015 * (meanLPrime - 50) ** 2) / Math.sqrt(20 + (meanLPrime - 50) ** 2);
  const sC = 1 + 0.045 * meanCPrime;
  const sH = 1 + 0.015 * meanCPrime * t;
  const rT = -Math.sin(degreesToRadians(2 * deltaTheta)) * rC;

  const lTerm = deltaLPrime / sL;
  const cTerm = deltaCPrime / sC;
  const hTerm = deltaHPrime / sH;

  return Math.sqrt(lTerm ** 2 + cTerm ** 2 + hTerm ** 2 + rT * cTerm * hTerm);
}

export function contrastTextColor(hex: string): '#111111' | '#FFFFFF' {
  const { r, g, b } = hexToRgb(hex);
  const luminance =
    0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  return luminance > 0.36 ? '#111111' : '#FFFFFF';
}
