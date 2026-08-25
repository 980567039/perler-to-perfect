export const PERFECT_PIXEL_ENDPOINT = '/api/perfect-pixel';
export const PERFECT_PIXEL_VERSION = '0.1.4';

export type PerfectPixelSampleMethod = 'center' | 'median' | 'majority';

export interface PerfectPixelRequest {
  image: string;
  sampleMethod: PerfectPixelSampleMethod;
  gridSize: [number, number];
  refineIntensity: number;
  fixSquare: boolean;
}

export interface PerfectPixelSuccess {
  ok: true;
  engine: 'perfect-pixel';
  version: string;
  width: number;
  height: number;
  /** PNG data URL containing one representative RGB pixel per grid cell. */
  image: string;
  /** Base64-encoded one-byte alpha coverage for each row-major grid cell. */
  alpha?: string;
  settings: Omit<PerfectPixelRequest, 'image'>;
}

export interface PerfectPixelFailure {
  ok: false;
  code: string;
  error: string;
  detail?: string;
}

export type PerfectPixelResponse = PerfectPixelSuccess | PerfectPixelFailure;
