export type EditorIconName =
  | 'paint'
  | 'eyedropper'
  | 'wand'
  | 'lasso'
  | 'erase'
  | 'pan'
  | 'undo'
  | 'redo'
  | 'beads'
  | 'grid'
  | 'ironed'
  | 'fit';

interface EditorIconProps {
  name: EditorIconName;
  size?: number;
}

export function EditorIcon({ name, size = 15 }: EditorIconProps) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
  };

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === 'paint' ? <path {...common} d="m14.8 4.2 5 5L8.4 20.6l-4.1.9.9-4.1L16.6 6.2m-2.8 1.3 2.7 2.7M4.8 17.4l2.8 2.8" /> : null}
      {name === 'eyedropper' ? <path {...common} d="m14 4 6 6-2.2 2.2-1.5-1.5-7.7 7.7H5.2v-3.4l7.7-7.7-1.5-1.5L14 4Zm-8.5 14.5h3" /> : null}
      {name === 'wand' ? <path {...common} d="m14.5 4.5 5 5M4.5 19.5l10-10M4 4v3m-1.5-1.5h3M19 16v4m-2  -2h4M8 10V7m-1.5 1.5h3" /> : null}
      {name === 'lasso' ? <path {...common} d="M19.5 8.8c0 3.2-3.8 5.8-8.5 5.8S2.5 12 2.5 8.8 6.3 3 11 3s8.5 2.6 8.5 5.8Zm-5.2 5.4c1.5 2.8 1.1 5.4-.7 6.1-1.6.6-3.4-.6-4-2.8-.4-1.3-.2-2.7.5-3.8" /> : null}
      {name === 'erase' ? <path {...common} d="m3.8 14.8 9.7-9.7a2.2 2.2 0 0 1 3.1 0l2.3 2.3a2.2 2.2 0 0 1 0 3.1l-7.8 7.8H6.5l-2.7-2.7a2.1 2.1 0 0 1 0-2.8Zm5.2 3.5 7.5-7.5m-3.2 7.5h7" /> : null}
      {name === 'pan' ? <path {...common} d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-1V6a1.5 1.5 0 0 1 3 0v7.5M8 10V8.5a1.5 1.5 0 0 0-3 0v5.2c0 1.7.6 3.1 1.8 4.3l1.3 1.3h6.4c2.5 0 4.5-2 4.5-4.5V13a1.5 1.5 0 0 0-3 0" /> : null}
      {name === 'undo' ? <path {...common} d="M9 7 4 12l5 5M4 12h9a6 6 0 0 1 6 6" /> : null}
      {name === 'redo' ? <path {...common} d="m15 7 5 5-5 5m5-5h-9a6 6 0 0 0-6 6" /> : null}
      {name === 'beads' ? <><circle {...common} cx="8" cy="8" r="3" /><circle {...common} cx="16" cy="8" r="3" /><circle {...common} cx="8" cy="16" r="3" /><circle {...common} cx="16" cy="16" r="3" /></> : null}
      {name === 'grid' ? <><rect {...common} x="4" y="4" width="16" height="16" rx="1" /><path {...common} d="M4 10h16M4 16h16M10 4v16M16 4v16" /></> : null}
      {name === 'ironed' ? <><path {...common} d="M4 17h16M6 17 9 7h7l3 10M9 7l-2-3h8l1 3" /><path {...common} d="M4 20h16" /></> : null}
      {name === 'fit' ? <><path {...common} d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5" /><path {...common} d="M3 8 8 3M16 3l5 5M3 16l5 5M16 21l5-5" /></> : null}
    </svg>
  );
}
