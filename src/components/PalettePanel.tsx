import type { ColorCount, PaletteManifest } from '../domain/types';

interface PalettePanelProps {
  palette: PaletteManifest;
  enabledColorIds: string[];
  lockedColorIds: string[];
  selectedPaletteIndex: number;
  counts: ColorCount[];
  onSelect: (index: number) => void;
  onToggleEnabled: (id: string) => void;
  onToggleLocked: (id: string) => void;
}

export function PalettePanel({
  palette,
  enabledColorIds,
  lockedColorIds,
  selectedPaletteIndex,
  counts,
  onSelect,
  onToggleEnabled,
  onToggleLocked,
}: PalettePanelProps) {
  const enabled = new Set(enabledColorIds);
  const countByPaletteIndex = new Map(counts.map((entry) => [entry.paletteIndex, entry.count]));
  return (
    <div className="palette-grid" aria-label="色板">
      {palette.colors.map((color, index) => {
        const isEnabled = enabled.has(color.id);
        const isLocked = lockedColorIds.includes(color.id);
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
            <button
              type="button"
              className={`palette-lock ${isLocked ? 'active' : ''}`}
              disabled={!isEnabled}
              title={isLocked ? '取消锁定色号' : '锁定色号，生成时必须保留'}
              onClick={() => onToggleLocked(color.id)}
            >
              {isLocked ? '锁' : '—'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
