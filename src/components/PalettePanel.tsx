import type { ColorCount, PaletteManifest } from '../domain/types';

interface PalettePanelProps {
  palette: PaletteManifest;
  enabledColorIds: string[];
  selectedPaletteIndex: number;
  counts: ColorCount[];
  onSelect: (index: number) => void;
  onToggleEnabled: (id: string) => void;
}

export function PalettePanel({
  palette,
  enabledColorIds,
  selectedPaletteIndex,
  counts,
  onSelect,
  onToggleEnabled,
}: PalettePanelProps) {
  const enabled = new Set(enabledColorIds);
  const countByPaletteIndex = new Map(counts.map((entry) => [entry.paletteIndex, entry.count]));
  return (
    <div className="palette-grid" aria-label="色板">
      {palette.colors.map((color, index) => {
        const isEnabled = enabled.has(color.id);
        return (
          <div
            className={`palette-item ${selectedPaletteIndex === index ? 'selected' : ''} ${isEnabled ? '' : 'disabled'}`}
            key={color.id}
          >
            <button type="button" className="palette-select" onClick={() => onSelect(index)} title={color.name ?? color.code}>
              <span className="swatch" style={{ backgroundColor: color.srgbHex }} />
              <span className="palette-code">{color.code}</span>
              <span className="palette-count">{countByPaletteIndex.get(index) ?? ''}</span>
            </button>
            <label className="palette-enabled" title={isEnabled ? '生成时允许使用' : '生成时禁止使用'}>
              <input type="checkbox" checked={isEnabled} onChange={() => onToggleEnabled(color.id)} />
            </label>
          </div>
        );
      })}
    </div>
  );
}
