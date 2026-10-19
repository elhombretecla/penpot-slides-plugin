import { useEffect, useMemo, useRef, useState } from 'react';
import { useSlideStore } from '../store';
import type { FontInfo, FontVariantInfo, SlideNode } from '../types';

const MAX_RESULTS = 80;

// Closest variant of `font` to a weight / style (same style first).
export function closestVariant(font: FontInfo, weight = '400', style: 'normal' | 'italic' = 'normal'): FontVariantInfo | undefined {
  const target = parseInt(weight, 10) || 400;
  const pool = font.variants.filter((v) => v.style === style);
  const candidates = pool.length > 0 ? pool : font.variants;
  return [...candidates].sort(
    (a, b) => Math.abs((parseInt(a.weight, 10) || 400) - target) - Math.abs((parseInt(b.weight, 10) || 400) - target)
  )[0];
}

export function useFonts() {
  const fonts = useSlideStore((s) => s.fonts);
  const requestFonts = useSlideStore((s) => s.requestFonts);
  useEffect(() => requestFonts(), [requestFonts]);
  return fonts;
}

// Font ids used anywhere in the open deck, most used first.
function useDeckFontIds(): string[] {
  const slides = useSlideStore((s) => s.slides);
  return useMemo(() => {
    const count = new Map<string, number>();
    const visit = (nodes: SlideNode[]) => {
      for (const n of nodes) {
        if (n.type === 'text' && n.fontId) count.set(n.fontId, (count.get(n.fontId) ?? 0) + 1);
        if (n.children) visit(n.children);
      }
    };
    slides.forEach((s) => visit(s.nodes));
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [slides]);
}

// Searchable list of Penpot's fonts: the deck's fonts first, then the team's
// uploaded fonts, then everything else.
export default function FontPicker({
  node,
  onPick,
}: {
  node: SlideNode;
  onPick: (font: FontInfo, variant: FontVariantInfo | undefined) => void;
}) {
  const fonts = useFonts();
  const deckFontIds = useDeckFontIds();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const groups = useMemo(() => {
    if (!fonts) return [];
    const q = query.trim().toLowerCase();
    const match = (f: FontInfo) => !q || f.name.toLowerCase().includes(q);
    const byId = new Map(fonts.map((f) => [f.id, f]));
    const used = deckFontIds.map((id) => byId.get(id)).filter((f): f is FontInfo => !!f && match(f));
    const usedIds = new Set(used.map((f) => f.id));
    const team = fonts.filter((f) => f.custom && !usedIds.has(f.id) && match(f));
    const rest = fonts.filter((f) => !f.custom && !usedIds.has(f.id) && match(f));
    let budget = MAX_RESULTS;
    const take = (list: FontInfo[]) => {
      const out = list.slice(0, Math.max(0, budget));
      budget -= out.length;
      return out;
    };
    return [
      { label: 'In this presentation', fonts: take(used) },
      { label: 'Team fonts', fonts: take(team) },
      { label: 'All fonts', fonts: take(rest) },
    ].filter((g) => g.fonts.length > 0);
  }, [fonts, deckFontIds, query]);

  const current = fonts?.find((f) => f.id === node.fontId);
  const label = current?.name ?? node.fontFamily ?? 'Default';

  return (
    <div className="font-picker" ref={rootRef}>
      <button className="font-picker-btn" onClick={() => setOpen((v) => !v)} title="Change font">
        <span className="prop-ellipsis">{label}</span>
        {current?.custom && <span className="font-tag">Team</span>}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="font-picker-pop">
          <input
            autoFocus
            className="input input-sm"
            placeholder="Search fonts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'Enter') {
                const first = groups[0]?.fonts[0];
                if (first) {
                  onPick(first, closestVariant(first, node.fontWeight, node.fontStyle));
                  setOpen(false);
                }
              }
            }}
          />
          <div className="font-picker-list">
            {!fonts && <div className="font-picker-empty">Loading fonts…</div>}
            {fonts && groups.length === 0 && <div className="font-picker-empty">No fonts match “{query}”.</div>}
            {groups.map((g) => (
              <div key={g.label}>
                <div className="font-picker-group">{g.label}</div>
                {g.fonts.map((f) => (
                  <button
                    key={f.id}
                    className={`font-picker-item ${f.id === node.fontId ? 'active' : ''}`}
                    onClick={() => {
                      onPick(f, closestVariant(f, node.fontWeight, node.fontStyle));
                      setOpen(false);
                    }}
                  >
                    <span className="prop-ellipsis">{f.name}</span>
                    <span className="font-picker-meta">{f.custom ? 'Team · ' : ''}{f.variants.length}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {current?.custom && (
        <p className="font-picker-hint">Team font: the quick preview uses a fallback; the Penpot render shows it exactly.</p>
      )}
    </div>
  );
}
