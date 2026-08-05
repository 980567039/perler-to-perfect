import { z } from 'zod';
import { normalizeHex } from './color';
import type { BeadColor, PaletteManifest } from './types';

const codePattern = /^[A-Za-z0-9-]{1,4}$/;

const colorSchema = z.object({
  id: z.string().min(1).max(80),
  code: z.string().regex(codePattern, '色号必须是 1–4 位 ASCII 字母、数字或连字符。'),
  name: z.string().max(120).optional(),
  srgbHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  labD65: z
    .object({ l: z.number(), a: z.number(), b: z.number() })
    .optional(),
  series: z.string().max(40).optional(),
  tags: z.array(z.string().max(40)).optional(),
});

const paletteSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(100),
  brand: z.string().min(1).max(100),
  edition: z.string().min(1).max(100),
  version: z.string().min(1).max(40),
  source: z.object({
    label: z.string().min(1).max(240),
    url: z.string().url().optional(),
    license: z.string().max(120).optional(),
    retrievedAt: z.string().optional(),
  }),
  colors: z.array(colorSchema).min(2).max(512),
});

export function validatePaletteManifest(value: unknown): PaletteManifest {
  const parsed = paletteSchema.parse(value);
  const ids = new Set<string>();
  const codes = new Set<string>();
  const colors = parsed.colors.map<BeadColor>((color) => {
    if (ids.has(color.id)) throw new Error(`色板包含重复 ID：${color.id}`);
    if (codes.has(color.code.toUpperCase())) throw new Error(`色板包含重复色号：${color.code}`);
    ids.add(color.id);
    codes.add(color.code.toUpperCase());
    return {
      ...color,
      code: color.code.toUpperCase(),
      srgbHex: normalizeHex(color.srgbHex),
    };
  });
  return { ...parsed, colors } as PaletteManifest;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field.trim());
      field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error('CSV 存在未闭合的引号。');
  return rows;
}

export function paletteFromCsv(text: string, fileName: string): PaletteManifest {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''));
  const header = rows.shift()?.map((value) => value.toLowerCase());
  if (!header) throw new Error('CSV 为空。');
  const codeColumn = header.indexOf('code');
  const hexColumn = header.indexOf('hex');
  const nameColumn = header.indexOf('name');
  const seriesColumn = header.indexOf('series');
  if (codeColumn < 0 || hexColumn < 0) {
    throw new Error('CSV 必须包含 code 和 hex 表头。');
  }

  const safeId = fileName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase() || 'custom';
  const colors = rows.map<BeadColor>((row, index) => {
    const code = row[codeColumn]?.toUpperCase() ?? '';
    const hex = row[hexColumn] ?? '';
    return {
      id: `${safeId}:${code || index + 1}`,
      code,
      srgbHex: normalizeHex(hex),
      name: nameColumn >= 0 ? row[nameColumn] || undefined : undefined,
      series: seriesColumn >= 0 ? row[seriesColumn] || undefined : undefined,
    };
  });

  return validatePaletteManifest({
    schemaVersion: 1,
    id: `custom:${safeId}`,
    brand: 'Custom',
    edition: fileName,
    version: '1',
    source: { label: `Imported from ${fileName}` },
    colors,
  });
}

export function paletteFromFileContents(text: string, fileName: string): PaletteManifest {
  if (fileName.toLowerCase().endsWith('.csv')) return paletteFromCsv(text, fileName);
  return validatePaletteManifest(JSON.parse(text) as unknown);
}
