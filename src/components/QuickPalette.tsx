import { useEffect, useMemo, useRef, useState } from 'react';
import type { BeadColor, ColorCount, PaletteManifest } from '../domain/types';

interface QuickPaletteProps {
  palette: PaletteManifest;
  counts: ColorCount[];
  selectedPaletteIndex: number;
  onSelectColor: (paletteIndex: number) => void;
}

interface UsedColor {
  color: BeadColor;
  paletteIndex: number;
  count: number;
}

function colorSearchText(color: BeadColor): string {
  return [color.code, color.name, color.series, color.id, ...(color.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}

function Swatch({ color, selected = false }: { color: BeadColor; selected?: boolean }) {
  return (
    <span
      className={`quick-color-swatch${selected ? ' selected' : ''}`}
      style={{ backgroundColor: color.srgbHex }}
      aria-hidden="true"
    />
  );
}

export function QuickPalette({ palette, counts, selectedPaletteIndex, onSelectColor }: QuickPaletteProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedColor = palette.colors[selectedPaletteIndex] ?? palette.colors[0];

  const usedColors = useMemo<UsedColor[]>(() => {
    return counts
      .slice()
      .sort((left, right) => right.count - left.count || left.paletteIndex - right.paletteIndex)
      .flatMap((entry) => {
        const color = palette.colors[entry.paletteIndex];
        return color ? [{ color, paletteIndex: entry.paletteIndex, count: entry.count }] : [];
      });
  }, [counts, palette.colors]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selectedCount = counts.find((entry) => entry.paletteIndex === selectedPaletteIndex)?.count ?? 0;
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    return palette.colors.filter((color) => colorSearchText(color).includes(normalizedQuery)).slice(0, 48);
  }, [normalizedQuery, palette.colors]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    searchRef.current?.focus();
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const selectColor = (paletteIndex: number) => {
    onSelectColor(paletteIndex);
    setIsOpen(false);
    setQuery('');
  };

  return (
    <div className="quick-palette-anchor" ref={rootRef}>
      <button
        type="button"
        className={`current-color-trigger${isOpen ? ' active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={selectedColor ? `当前画笔颜色 ${selectedColor.code}，打开 Quick Palette` : '打开 Quick Palette'}
        onClick={() => setIsOpen((open) => !open)}
      >
        {selectedColor ? <Swatch color={selectedColor} selected /> : <span className="quick-color-swatch empty" aria-hidden="true" />}
        <span className="current-color-copy">
          <small>当前颜色</small>
          <strong>{selectedColor?.code ?? '未选择'}</strong>
        </span>
        <span className="current-color-caret" aria-hidden="true">⌄</span>
      </button>

      {isOpen ? (
        <div className="quick-palette-popover" role="dialog" aria-label="Quick Palette 快速色板">
          <div className="quick-palette-heading">
            <div>
              <span className="quick-palette-kicker">QUICK PALETTE</span>
              <strong>选择画笔颜色</strong>
            </div>
            <button type="button" className="quick-palette-close" aria-label="关闭 Quick Palette" onClick={() => setIsOpen(false)}>
              ×
            </button>
          </div>

          {selectedColor ? (
            <div className="quick-current-color">
              <Swatch color={selectedColor} selected />
              <div>
                <strong>{selectedColor.code}</strong>
                <span>{selectedColor.name ?? selectedColor.id}</span>
              </div>
              <span className="quick-current-meta">
                <span className="quick-current-count">{selectedCount > 0 ? `${selectedCount} 颗` : '未使用'}</span>
                <span className="quick-current-status">画笔</span>
              </span>
            </div>
          ) : null}

          <section className="quick-palette-section" aria-labelledby="quick-used-colors-heading">
            <div className="quick-section-heading">
              <span id="quick-used-colors-heading">图中已用色</span>
              <em>{usedColors.length}</em>
            </div>
            {usedColors.length > 0 ? (
              <div className="quick-color-grid" role="group" aria-label="图中已用颜色">
                {usedColors.map(({ color, paletteIndex, count }) => (
                  <button
                    type="button"
                    className={`quick-color-button${selectedPaletteIndex === paletteIndex ? ' selected' : ''}`}
                    key={color.id}
                    title={`${color.code} · ${color.name ?? color.id} · ${count} 颗`}
                    aria-label={`选择 ${color.code}，${count} 颗`}
                    aria-pressed={selectedPaletteIndex === paletteIndex}
                    onClick={() => selectColor(paletteIndex)}
                  >
                    <Swatch color={color} selected={selectedPaletteIndex === paletteIndex} />
                    <span>{color.code}</span>
                    <small>{count}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="quick-empty-state">当前还没有图纸用色。可以在下方搜索完整色板后开始绘制。</p>
            )}
          </section>

          <section className="quick-palette-section full-palette-search" aria-labelledby="full-palette-heading">
            <div className="quick-section-heading">
              <span id="full-palette-heading">完整色板</span>
              <em>{palette.colors.length} 色</em>
            </div>
            <label className="quick-search-field">
              <span aria-hidden="true">⌕</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder="搜索色号、名称或系列…"
                aria-label="搜索完整色板"
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? (
                <button type="button" aria-label="清除色板搜索" onClick={() => setQuery('')}>
                  ×
                </button>
              ) : null}
            </label>
            <div className="full-palette-results" role="listbox" aria-label="完整色板搜索结果">
              {!normalizedQuery ? <p className="quick-search-hint">输入色号、名称或系列查找未使用颜色。</p> : null}
              {normalizedQuery && searchResults.length === 0 ? <p className="quick-search-hint">没有匹配的色号。</p> : null}
              {searchResults.map((color) => {
                const paletteIndex = palette.colors.indexOf(color);
                return (
                  <button
                    type="button"
                    className={`full-palette-result${selectedPaletteIndex === paletteIndex ? ' selected' : ''}`}
                    key={color.id}
                    role="option"
                    aria-selected={selectedPaletteIndex === paletteIndex}
                    aria-label={`${color.code} ${color.name ?? color.series ?? color.id}`}
                    onClick={() => selectColor(paletteIndex)}
                  >
                    <Swatch color={color} selected={selectedPaletteIndex === paletteIndex} />
                    <span>
                      <strong>{color.code}</strong>
                      <small>{color.name ?? color.series ?? color.id}</small>
                    </span>
                    {selectedPaletteIndex === paletteIndex ? <em>当前</em> : null}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
