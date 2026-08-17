export const SUBJECT_HINTS_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type SubjectHintsImageMimeType = (typeof SUBJECT_HINTS_IMAGE_MIME_TYPES)[number];

export const MAX_SUBJECT_HINTS_IMAGE_BYTES = 4 * 1024 * 1024;
export const SUBJECT_HINTS_ENDPOINT = '/api/subject-hints';

export interface SubjectHintsBoundingBox {
  /** Normalized horizontal origin in the source image. */
  x: number;
  /** Normalized vertical origin in the source image. */
  y: number;
  /** Normalized width of the subject. */
  width: number;
  /** Normalized height of the subject. */
  height: number;
}

export interface SubjectHintsForegroundSeed {
  /** Normalized horizontal coordinate in the source image. */
  x: number;
  /** Normalized vertical coordinate in the source image. */
  y: number;
  kind: 'inside' | 'outside';
}

export interface SubjectHintsFocusRegion {
  /** Normalized horizontal coordinate in the source image. */
  x: number;
  /** Normalized vertical coordinate in the source image. */
  y: number;
  /** Radius normalized against the longest image dimension. */
  radius: number;
  kind: 'face' | 'eye' | 'outline' | 'accessory';
  confidence: number;
}

export interface SubjectHints {
  bbox: SubjectHintsBoundingBox;
  foregroundSeeds: SubjectHintsForegroundSeed[];
  focusRegions: SubjectHintsFocusRegion[];
  confidence: number;
}

export interface SubjectHintsRequestBody {
  /** A data URL containing the cropped image. Remote URLs are not accepted. */
  image: string;
  mimeType: SubjectHintsImageMimeType;
}

export interface SubjectHintsApiSuccess {
  ok: true;
  hints: SubjectHints;
}

export type SubjectHintsApiFailureCode =
  | 'SUBJECT_HINTS_DISABLED'
  | 'INVALID_REQUEST'
  | 'METHOD_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UPSTREAM_ERROR'
  | 'INVALID_MODEL_OUTPUT';

export interface SubjectHintsApiFailure {
  ok: false;
  code: SubjectHintsApiFailureCode;
  message: string;
}

export type SubjectHintsApiResponse = SubjectHintsApiSuccess | SubjectHintsApiFailure;

export type SubjectHintsClientFailureCode =
  | SubjectHintsApiFailureCode
  | 'INVALID_IMAGE'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE';

export interface SubjectHintsClientFailure {
  ok: false;
  code: SubjectHintsClientFailureCode;
  status?: number;
}

export type SubjectHintsClientResult = SubjectHintsApiSuccess | SubjectHintsClientFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isNormalizedBoundingBox(value: unknown): value is SubjectHintsBoundingBox {
  if (!isRecord(value)) return false;
  const { x, y, width, height } = value;
  return (
    isUnitInterval(x) &&
    isUnitInterval(y) &&
    typeof width === 'number' &&
    Number.isFinite(width) &&
    width > 0 &&
    width <= 1 &&
    typeof height === 'number' &&
    Number.isFinite(height) &&
    height > 0 &&
    height <= 1 &&
    x + width <= 1 &&
    y + height <= 1
  );
}

function isForegroundSeed(value: unknown): value is SubjectHintsForegroundSeed {
  if (!isRecord(value)) return false;
  return (
    isUnitInterval(value.x) &&
    isUnitInterval(value.y) &&
    (value.kind === 'inside' || value.kind === 'outside')
  );
}

function isFocusRegion(value: unknown): value is SubjectHintsFocusRegion {
  if (!isRecord(value)) return false;
  return (
    isUnitInterval(value.x) &&
    isUnitInterval(value.y) &&
    typeof value.radius === 'number' &&
    Number.isFinite(value.radius) &&
    value.radius > 0 &&
    value.radius <= 1 &&
    (value.kind === 'face' ||
      value.kind === 'eye' ||
      value.kind === 'outline' ||
      value.kind === 'accessory') &&
    isUnitInterval(value.confidence)
  );
}

export function isSubjectHints(value: unknown): value is SubjectHints {
  if (!isRecord(value)) return false;
  return (
    isNormalizedBoundingBox(value.bbox) &&
    Array.isArray(value.foregroundSeeds) &&
    value.foregroundSeeds.length <= 64 &&
    value.foregroundSeeds.every(isForegroundSeed) &&
    Array.isArray(value.focusRegions) &&
    value.focusRegions.length <= 48 &&
    value.focusRegions.every(isFocusRegion) &&
    isUnitInterval(value.confidence)
  );
}

export function isSubjectHintsImageMimeType(value: unknown): value is SubjectHintsImageMimeType {
  return typeof value === 'string' &&
    (SUBJECT_HINTS_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

