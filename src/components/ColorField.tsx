import { useEffect, useState } from 'react';
import type { ColorTokenInfo, LibraryColorInfo } from '../types';
import { normalizeHex } from '../utils';

// Color control: hex / native picker plus the colors worth reusing — the
// library's colors (linked), the file's color tokens (bound), the colors
// already used in the deck and recent picks. An unlinked color can be saved
// to the file's library.
export default function ColorField({
  value,
  onChange,
  swatches = [],
  linkedId,
  onPickSwatch,
  tokens = [],
  linkedToken,
  onPickToken,
  deckColors = [],
  recent = [],
  onAddToLibrary,
}: {
  value: string;
  onChange: (v: string) => void;
  swatches?: LibraryColorInfo[];
  linkedId?: string;
  onPickSwatch?: (c: LibraryColorInfo) => void;
  tokens?: ColorTokenInfo[];
  linkedToken?: string;
  onPickToken?: (t: ColorTokenInfo) => void;
  deckColors?: string[];
  recent?: string[];
  onAddToLibrary?: (name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [naming, setNaming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const linked = swatches.find((c) => c.id === linkedId);
  const token = tokens.find((t) => t.name === linkedToken);
  const hex = normalizeHex(value) ?? '#000000';
  const others = [...new Set([...recent, ...deckColors])]
    .filter((c) => c !== hex && !swatches.some((s) => normalizeHex(s.color ?? '') === c))
    .slice(0, 10);

  return (
    <div className="prop-color">
      <div className="prop-color-wrap">
        <input className="prop-color-swatch" type="color" value={hex} onChange={(e) => onChange(e.target.value)} />
        {linked || token ? (
          <span className="prop-color-linked body-xs" title={token ? `Color token (${token.setName})` : 'Linked to a library color'}>
            {token ? <span className="token-mark">◆</span> : null}
            {token?.name ?? linked?.name}
          </span>
        ) : (
          <input
            className="input"
            type="text"
            value={draft}
            maxLength={7}
            style={{ width: '80px', fontFamily: 'monospace', fontSize: 'var(--font-size-xs)', paddingBlock: 'var(--spacing-4)' }}
            onChange={(e) => {
              const raw = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
              if (!/^#[0-9a-fA-F]{0,6}$/.test(raw)) return;
              setDraft(raw);
              const next = normalizeHex(raw);
              if (next && raw.length === 7) onChange(next);
            }}
            onBlur={() => {
              const next = normalizeHex(draft);
              if (next) onChange(next);
              else setDraft(value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            }}
          />
        )}
        {!linked && !token && onAddToLibrary && naming === null && (
          <button className="color-add-btn" title="Save this color in the file's library" onClick={() => setNaming('')}>
            +
          </button>
        )}
      </div>

      {naming !== null && onAddToLibrary && (
        <form
          className="color-name-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const name = naming.trim();
            if (!name) return;
            setSaving(true);
            try {
              await onAddToLibrary(name);
              setNaming(null);
            } finally {
              setSaving(false);
            }
          }}
        >
          <input
            autoFocus
            className="input input-sm"
            placeholder="Color name (Group / Name)"
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNaming(null);
            }}
          />
          <button type="submit" className="btn-link" disabled={saving || !naming.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}

      {swatches.length > 0 && onPickSwatch && (
        <div className="prop-swatches" title="Library colors">
          {swatches.map((c) => (
            <button
              key={c.id}
              className={`prop-swatch ${c.id === linkedId ? 'active' : ''}`}
              style={{ background: c.color, opacity: c.opacity ?? 1 }}
              title={`${c.path ? `${c.path} / ` : ''}${c.name} ${c.color ?? ''}`}
              onClick={() => onPickSwatch(c)}
            />
          ))}
        </div>
      )}
      {tokens.length > 0 && onPickToken && (
        <div className="prop-swatches" title="Color tokens">
          {tokens.map((t) => (
            <button
              key={t.id}
              className={`prop-swatch prop-swatch--token ${t.name === linkedToken ? 'active' : ''}`}
              style={{ background: t.value }}
              title={`Token ${t.name} ${t.value}`}
              onClick={() => onPickToken(t)}
            />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="prop-swatches prop-swatches--plain" title="Colors used in this presentation and recent picks">
          {others.map((c) => (
            <button key={c} className="prop-swatch" style={{ background: c }} title={c} onClick={() => onChange(c)} />
          ))}
        </div>
      )}
    </div>
  );
}
