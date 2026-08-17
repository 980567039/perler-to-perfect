import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEVELOPMENT_PALETTE } from '../domain/devPalette';
import type { ColorCount } from '../domain/types';
import { QuickPalette } from './QuickPalette';

afterEach(() => cleanup());

const counts: ColorCount[] = [
  { colorId: 'dev:D01', paletteIndex: 0, count: 2 },
  { colorId: 'dev:D02', paletteIndex: 1, count: 9 },
  { colorId: 'dev:D03', paletteIndex: 2, count: 4 },
];

function renderQuickPalette(overrides: Partial<React.ComponentProps<typeof QuickPalette>> = {}) {
  const onSelectColor = vi.fn();
  const props: React.ComponentProps<typeof QuickPalette> = {
    palette: DEVELOPMENT_PALETTE,
    counts,
    selectedPaletteIndex: 0,
    onSelectColor,
    ...overrides,
  };
  render(<QuickPalette {...props} />);
  return { onSelectColor };
}

describe('QuickPalette', () => {
  it('shows used colors by bead count and selects a color from the quick palette', () => {
    const { onSelectColor } = renderQuickPalette();

    fireEvent.click(screen.getByRole('button', { name: /当前画笔颜色 D01/ }));

    const usedColors = screen.getByRole('group', { name: '图中已用颜色' });
    const buttons = Array.from(usedColors.querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['D029', 'D034', 'D012']);

    fireEvent.click(screen.getByRole('button', { name: '选择 D02，9 颗' }));
    expect(onSelectColor).toHaveBeenCalledWith(1);
    expect(counts).toEqual([
      { colorId: 'dev:D01', paletteIndex: 0, count: 2 },
      { colorId: 'dev:D02', paletteIndex: 1, count: 9 },
      { colorId: 'dev:D03', paletteIndex: 2, count: 4 },
    ]);
  });

  it('searches the complete palette by name and can select an unused color', () => {
    const { onSelectColor } = renderQuickPalette({ counts: [] });

    fireEvent.click(screen.getByRole('button', { name: /当前画笔颜色 D01/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索完整色板' }), { target: { value: 'ocean' } });

    const result = screen.getByRole('option', { name: /D12 Ocean Blue/ });
    expect(result).toBeVisible();
    fireEvent.click(result);
    expect(onSelectColor).toHaveBeenCalledWith(11);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('supports empty state and closes on Escape or outside pointer down', () => {
    renderQuickPalette({ counts: [] });

    fireEvent.click(screen.getByRole('button', { name: /当前画笔颜色 D01/ }));
    expect(screen.getByText('当前还没有图纸用色。可以在下方搜索完整色板后开始绘制。')).toBeVisible();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /当前画笔颜色 D01/ }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
