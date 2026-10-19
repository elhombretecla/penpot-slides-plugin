import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Slide } from '../types';
import type { CanvasCommands } from '../canvas/commands';
import { findNodeById } from '../utils';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

interface Props {
  x: number;
  y: number;
  slide: Slide;
  selectedIds: string[];
  commands: CanvasCommands;
  onPasteHere: () => void;
  onClose: () => void;
}

type Item = { label: string; keys?: string; run: () => void; disabled?: boolean; danger?: boolean } | 'separator';

// Right-click menu of the canvas: the usual editing and stacking commands,
// each also reachable from the keyboard (shown on the right).
export default function CanvasContextMenu({ x, y, slide, selectedIds, commands, onPasteHere, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu inside the plugin window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('wheel', onClose, { passive: true });
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('wheel', onClose);
    };
  }, [onClose]);

  const has = selectedIds.length > 0;
  const single = selectedIds.length === 1 ? findNodeById(slide.nodes, selectedIds[0]) : null;
  const items: Item[] = has
    ? [
        ...(single?.type === 'text' ? [{ label: 'Edit text', keys: 'Enter', run: commands.editText }, 'separator' as const] : []),
        { label: 'Cut', keys: `${MOD}X`, run: commands.cut },
        { label: 'Copy', keys: `${MOD}C`, run: commands.copy },
        { label: 'Paste here', keys: `${MOD}V`, run: onPasteHere, disabled: !commands.canPaste() },
        { label: 'Duplicate', keys: `${MOD}D`, run: commands.duplicate },
        'separator',
        { label: 'Bring to front', keys: `${MOD}⇧]`, run: () => commands.arrange('front') },
        { label: 'Bring forward', keys: `${MOD}]`, run: () => commands.arrange('forward') },
        { label: 'Send backward', keys: `${MOD}[`, run: () => commands.arrange('backward') },
        { label: 'Send to back', keys: `${MOD}⇧[`, run: () => commands.arrange('back') },
        'separator',
        { label: 'Delete', keys: 'Del', run: commands.remove, danger: true },
      ]
    : [
        { label: 'Paste here', keys: `${MOD}V`, run: onPasteHere, disabled: !commands.canPaste() },
        { label: 'Select all', keys: `${MOD}A`, run: commands.selectAll },
      ];

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`context-menu-item${item.danger ? ' context-menu-item--danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span>{item.label}</span>
            {item.keys && <span className="context-menu-keys">{item.keys}</span>}
          </button>
        )
      )}
    </div>
  );
}
