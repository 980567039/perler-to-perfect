import type { BeadColor, PaletteManifest } from './types';

const developmentColors: Array<[string, string, string]> = [
  ['D01', 'Paper White', '#F7F3EA'],
  ['D02', 'Warm Cream', '#F5D9A8'],
  ['D03', 'Sun Yellow', '#F4C430'],
  ['D04', 'Amber', '#E99B20'],
  ['D05', 'Coral', '#F06B59'],
  ['D06', 'Signal Red', '#C83349'],
  ['D07', 'Rose', '#DD6F9F'],
  ['D08', 'Blush', '#F4B6C2'],
  ['D09', 'Lavender', '#B79AD8'],
  ['D10', 'Deep Violet', '#6E4A9E'],
  ['D11', 'Sky Blue', '#75B9E7'],
  ['D12', 'Ocean Blue', '#3275B8'],
  ['D13', 'Navy', '#223A66'],
  ['D14', 'Mint', '#8ED1B2'],
  ['D15', 'Emerald', '#2B936D'],
  ['D16', 'Leaf Green', '#5A9F45'],
  ['D17', 'Olive', '#7F833F'],
  ['D18', 'Tan', '#C49367'],
  ['D19', 'Chestnut', '#7C4A3C'],
  ['D20', 'Dark Brown', '#412D2A'],
  ['D21', 'Light Gray', '#C9CCD0'],
  ['D22', 'Mid Gray', '#858990'],
  ['D23', 'Charcoal', '#3D4047'],
  ['D24', 'Black', '#111216'],
];

export const DEVELOPMENT_PALETTE: PaletteManifest = {
  schemaVersion: 1,
  id: 'development:illustration-24',
  brand: 'Development only',
  edition: 'Illustration 24',
  version: '1.0.0',
  source: {
    label: 'Synthetic colors created for application development; not MARD color data.',
    license: 'Project-owned synthetic fixture',
  },
  colors: developmentColors.map<BeadColor>(([code, name, srgbHex]) => ({
    id: `dev:${code}`,
    code,
    name,
    srgbHex: srgbHex as `#${string}`,
    tags: ['development', 'standard'],
  })),
};
