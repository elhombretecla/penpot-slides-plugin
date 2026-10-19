import { useEffect, useMemo, useRef, useState } from 'react';
import { useSlideStore } from '../store';
import type { LibraryColorInfo, LibraryTypographyInfo, Slide, SlideNode } from '../types';
import {
  findNodeById,
  normalizeHex,
  primaryFillHex,
  primaryFillRef,
  readImageFile,
  withPrimaryFill,
  withPrimaryFillColor,
} from '../utils';
import { isImageNode } from '../deck';
import { applyTemplates } from '../templateActions';

interface Props { slide: Slide | null; }

// Text style fields a library typography sets; editing any of them by hand
// unlinks the text from its typography.
const TYPOGRAPHY_FIELDS: (keyof SlideNode)[] = [
  'fontId', 'fontFamily', 'fontVariantId', 'fontSize', 'fontWeight', 'fontStyle',
  'lineHeight', 'letterSpacing', 'textTransform',
];

const ROLE_LABEL: Record<string, string> = {
  title: 'Title', subtitle: 'Subtitle', body: 'Body text', caption: 'Caption',
  image: 'Image', asset: 'Element', decoration: 'Decoration',
};

// Colors and text styles available to a slide: the deck's library first,
// then the slide's own template library.
function useLibraryStyles(slide: Slide | null) {
  const deckLibraryId = useSlideStore((s) => s.deck?.libraryId);
  const catalogs = useSlideStore((s) => s.catalogs);
  const requestCatalog = useSlideStore((s) => s.requestCatalog);
  const ids = useMemo(
    () => [...new Set([deckLibraryId, slide?.template?.libraryId].filter((x): x is string => !!x))],
    [deckLibraryId, slide?.template?.libraryId]
  );
  useEffect(() => {
    const missing = ids.find((id) => !useSlideStore.getState().catalogs[id]);
    if (missing) requestCatalog(missing);
  }, [ids, requestCatalog]);
  return useMemo(() => {
    const colors: LibraryColorInfo[] = [];
    const typographies: LibraryTypographyInfo[] = [];
    for (const id of ids) {
      colors.push(...(catalogs[id]?.colors ?? []).filter((c) => c.isFlat));
      typographies.push(...(catalogs[id]?.typographies ?? []));
    }
    return { colors, typographies };
  }, [ids, catalogs]);
}

function colorFill(c: LibraryColorInfo) {
  return { fillColor: c.color, fillOpacity: c.opacity ?? 1, fillColorRefId: c.id, fillColorRefFile: c.libraryId };
}

export default function PropertiesPanel({ slide }: Props) {
  const selectedNodeIds = useSlideStore((s) => s.selectedNodeIds);
  const updateNode = useSlideStore((s) => s.updateNode);
  const deleteNode = useSlideStore((s) => s.deleteNode);
  const commitHistory = useSlideStore((s) => s.commitHistory);
  const commitHistoryCoalesced = useSlideStore((s) => s.commitHistoryCoalesced);
  const styles = useLibraryStyles(slide);

  if (!slide) {
    return (
      <div className="properties-panel empty">
        <p className="panel-empty-msg">No slide selected</p>
      </div>
    );
  }

  // Template content is almost always nested inside groups / boards, so the
  // lookup must walk the whole tree, not only the top level.
  const selectedNode = selectedNodeIds.length === 1 ? findNodeById(slide.nodes, selectedNodeIds[0]) : null;

  // Every edit is undoable; bursts on the same fields (typing, spinning a
  // number input) collapse into a single undo step.
  function update(updates: Partial<SlideNode>) {
    if (!slide || !selectedNode) return;
    commitHistoryCoalesced(`node:${selectedNode.id}:${Object.keys(updates).sort().join(',')}`);
    const unlinks = selectedNode.typographyId && !('typographyId' in updates) &&
      TYPOGRAPHY_FIELDS.some((f) => f in updates);
    updateNode(slide.id, selectedNode.id, unlinks ? { ...updates, typographyId: undefined } : updates);
  }

  return (
    <div className="properties-panel">
      {selectedNodeIds.length > 1 ? (
        <p className="panel-empty-msg">{selectedNodeIds.length} elements selected</p>
      ) : !selectedNode ? (
        <SlideProperties slide={slide} colors={styles.colors} />
      ) : (
        <NodeProperties
          node={selectedNode}
          colors={styles.colors}
          typographies={styles.typographies}
          onUpdate={update}
          onDelete={() => {
            commitHistory();
            deleteNode(slide.id, selectedNode.id);
          }}
        />
      )}
    </div>
  );
}

// ─── Slide Properties ─────────────────────────────────────────────────────────

function SlideProperties({ slide, colors }: { slide: Slide; colors: LibraryColorInfo[] }) {
  const updateSlide = useSlideStore((s) => s.updateSlide);
  const commitHistoryCoalesced = useSlideStore((s) => s.commitHistoryCoalesced);
  const openPicker = useSlideStore((s) => s.openPicker);
  const template = slide.template;

  function setBackground(hex: string, fill?: Record<string, unknown>) {
    commitHistoryCoalesced(`slide:${slide.id}:background`);
    // Replace only the primary fill so gradients / overlays stay; without a
    // fills snapshot the flat color is enough.
    updateSlide(slide.id, {
      background: hex,
      backgroundFills: fill
        ? withPrimaryFill(slide.backgroundFills, fill)
        : withPrimaryFillColor(slide.backgroundFills, hex),
      backgroundImageUrl: slide.backgroundImageUrl,
    });
  }

  return (
    <div className="prop-sections">
      <div className="prop-section">
        <div className="prop-section-header">SLIDE</div>
        <PropRow label="Name">
          <input
            className="input input-sm"
            value={slide.name}
            onChange={(e) => {
              commitHistoryCoalesced(`slide:${slide.id}:name`);
              updateSlide(slide.id, { name: e.target.value });
            }}
          />
        </PropRow>
        <PropRow label="Size">
          <span className="prop-value-text body-xs">{slide.width} × {slide.height}</span>
        </PropRow>
        <PropRow label="Background">
          <ColorInput
            value={primaryFillHex(slide.backgroundFills, slide.background)}
            linkedId={primaryFillRef(slide.backgroundFills)}
            swatches={colors}
            onChange={(v) => setBackground(v)}
            onPickSwatch={(c) => setBackground(c.color ?? slide.background, colorFill(c))}
          />
        </PropRow>
      </div>

      <div className="prop-section">
        <div className="prop-section-header">LAYOUT</div>
        {template ? (
          <>
            <PropRow label="Template">
              <span className="prop-value-text body-xs prop-ellipsis" title={`${template.libraryName ?? ''} / ${template.path ?? ''}`}>
                {template.componentName}
              </span>
            </PropRow>
            <div className="prop-button-row">
              <button
                data-appearance="secondary"
                className="prop-btn"
                onClick={() => openPicker({ kind: 'change-layout', slideId: slide.id }, template.libraryId)}
              >
                Change layout…
              </button>
              <button
                data-appearance="secondary"
                className="prop-btn"
                title="Discard the changes made to this slide's template content"
                onClick={() =>
                  applyTemplates(
                    [{ componentId: template.componentId, libraryId: template.libraryId, componentName: template.componentName }],
                    { kind: 'reset-slide', slideId: slide.id }
                  )
                }
              >
                Reset
              </button>
            </div>
          </>
        ) : (
          <button
            data-appearance="secondary"
            className="prop-btn"
            onClick={() => openPicker({ kind: 'change-layout', slideId: slide.id })}
          >
            Apply a library layout…
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Node Properties ─────────────────────────────────────────────────────────

function NodeProperties({
  node,
  colors,
  typographies,
  onUpdate,
  onDelete,
}: {
  node: SlideNode;
  colors: LibraryColorInfo[];
  typographies: LibraryTypographyInfo[];
  onUpdate: (u: Partial<SlideNode>) => void;
  onDelete: () => void;
}) {
  const [showContent, setShowContent] = useState(true);
  const [showTypo, setShowTypo] = useState(true);
  const [showTransform, setShowTransform] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const isImage = isImageNode(node);
  const isShape = node.type === 'rect' || node.type === 'ellipse' || (node.type === 'group' && !!node.fills?.length);

  function applyTypography(t: LibraryTypographyInfo) {
    onUpdate({
      typographyId: t.id,
      typographyLibraryId: t.libraryId,
      fontId: t.fontId,
      fontFamily: t.fontFamily,
      fontVariantId: t.fontVariantId,
      fontSize: t.fontSize,
      fontWeight: t.fontWeight,
      fontStyle: t.fontStyle,
      lineHeight: t.lineHeight,
      letterSpacing: t.letterSpacing,
      textTransform: t.textTransform,
    });
  }

  return (
    <div className="prop-sections">
      <Accordion title="CONTENT" open={showContent} onToggle={() => setShowContent((v) => !v)}>
        <PropRow label="Name">
          <input className="input input-sm" value={node.name} onChange={(e) => onUpdate({ name: e.target.value })} />
        </PropRow>

        {node.slotId && (
          <PropRow label="Slot">
            <span className="prop-badge" title="Comes from the slide template">
              {ROLE_LABEL[node.role ?? ''] ?? 'Template'}{node.edited ? ' · edited' : ''}
            </span>
          </PropRow>
        )}

        {node.type === 'component-instance' && (
          <PropRow label="Component">
            <span className="prop-value-text body-xs prop-ellipsis" title="Inserted as a linked instance">
              {node.componentName ?? node.name}
            </span>
          </PropRow>
        )}

        {node.type === 'text' && (
          <PropRow label="Text">
            <textarea
              className="input"
              style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 'var(--font-size-s)', minHeight: '70px' }}
              value={node.text ?? ''}
              rows={3}
              onChange={(e) => onUpdate({ text: e.target.value })}
            />
          </PropRow>
        )}

        {isImage && (
          <PropRow label="Image">
            <button data-appearance="secondary" className="prop-btn" onClick={() => fileRef.current?.click()}>
              Replace image…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const img = await readImageFile(file);
                  onUpdate({ imageUrl: img.dataUrl, imageReplaced: true });
                } catch (err) {
                  useSlideStore.getState().pushNotice('error', err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </PropRow>
        )}

        {isShape && (
          <PropRow label="Fill">
            <ColorInput
              value={primaryFillHex(node.fills, node.fill ?? '#ffffff')}
              linkedId={primaryFillRef(node.fills)}
              swatches={colors}
              onChange={(v) => onUpdate({ fill: v, fills: withPrimaryFillColor(node.fills, v) })}
              onPickSwatch={(c) => onUpdate({ fill: c.color, fills: withPrimaryFill(node.fills, colorFill(c)) })}
            />
          </PropRow>
        )}

        <PropRow label="Opacity">
          <NumberInput
            value={Math.round(node.opacity * 100)}
            min={0} max={100} suffix="%"
            onChange={(v) => onUpdate({ opacity: v / 100 })}
          />
        </PropRow>

        <button className="prop-delete-btn" onClick={onDelete}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          </svg>
          Delete layer
        </button>
      </Accordion>

      {node.type === 'text' && (
        <Accordion title="TYPOGRAPHY" open={showTypo} onToggle={() => setShowTypo((v) => !v)}>
          {typographies.length > 0 && (
            <PropRow label="Style">
              <select
                className="select"
                style={{ blockSize: '28px', fontSize: 'var(--font-size-xs)' }}
                value={node.typographyId ?? ''}
                onChange={(e) => {
                  const t = typographies.find((x) => x.id === e.target.value);
                  if (t) applyTypography(t);
                }}
              >
                <option value="" disabled>{node.typographyId ? 'Unknown style' : 'Custom'}</option>
                {typographies.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.path ? `${t.path} / ` : ''}{t.name} — {t.fontSize}px
                  </option>
                ))}
              </select>
            </PropRow>
          )}

          <PropRow label="Font">
            <span className="prop-value-text body-xs prop-ellipsis">{node.fontFamily ?? 'Default'}</span>
          </PropRow>

          <div className="prop-row-2col">
            <div className="prop-field">
              <label className="prop-label-sm">Size</label>
              <NumberInput value={node.fontSize ?? 16} min={4} max={1000} onChange={(v) => onUpdate({ fontSize: v })} />
            </div>
            <div className="prop-field">
              <label className="prop-label-sm">Weight</label>
              <select
                className="select"
                style={{ blockSize: '28px', fontSize: 'var(--font-size-xs)' }}
                value={node.fontWeight ?? '400'}
                onChange={(e) => onUpdate({ fontWeight: e.target.value, fontVariantId: undefined })}
              >
                {['100', '200', '300', '400', '500', '600', '700', '800', '900'].map((w) => (
                  <option key={w} value={w}>{WEIGHT_LABEL[w]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="prop-row-2col">
            <div className="prop-field">
              <label className="prop-label-sm">Line height</label>
              <NumberInput value={node.lineHeight ?? 1.2} min={0.5} max={5} step={0.05} onChange={(v) => onUpdate({ lineHeight: v })} />
            </div>
            <div className="prop-field">
              <label className="prop-label-sm">Letter spacing</label>
              <NumberInput value={node.letterSpacing ?? 0} min={-50} max={200} step={0.5} onChange={(v) => onUpdate({ letterSpacing: v })} />
            </div>
          </div>

          <PropRow label="Color">
            <ColorInput
              value={primaryFillHex(node.fills, node.fontColor ?? '#ffffff')}
              linkedId={primaryFillRef(node.fills)}
              swatches={colors}
              onChange={(v) => onUpdate({ fontColor: v, fills: withPrimaryFillColor(node.fills, v) })}
              onPickSwatch={(c) => onUpdate({ fontColor: c.color, fills: withPrimaryFill(node.fills, colorFill(c)) })}
            />
          </PropRow>

          <PropRow label="Align">
            <AlignButtons value={node.textAlign ?? 'left'} onChange={(v) => onUpdate({ textAlign: v })} />
          </PropRow>

          <PropRow label="Vertical">
            <SegmentButtons
              value={node.verticalAlign ?? 'top'}
              options={[['top', 'Top'], ['center', 'Middle'], ['bottom', 'Bottom']]}
              onChange={(v) => onUpdate({ verticalAlign: v })}
            />
          </PropRow>

          <PropRow label="Style">
            <div className="align-buttons">
              <button
                className={`align-btn ${node.fontStyle === 'italic' ? 'active' : ''}`}
                title="Italic"
                onClick={() => onUpdate({ fontStyle: node.fontStyle === 'italic' ? 'normal' : 'italic', fontVariantId: undefined })}
              >
                <em>I</em>
              </button>
              <button
                className={`align-btn ${node.textDecoration === 'underline' ? 'active' : ''}`}
                title="Underline"
                onClick={() => onUpdate({ textDecoration: node.textDecoration === 'underline' ? undefined : 'underline' })}
              >
                <u>U</u>
              </button>
              <button
                className={`align-btn ${node.textTransform === 'uppercase' ? 'active' : ''}`}
                title="Uppercase"
                onClick={() => onUpdate({ textTransform: node.textTransform === 'uppercase' ? undefined : 'uppercase' })}
              >
                AA
              </button>
            </div>
          </PropRow>
        </Accordion>
      )}

      <Accordion title="TRANSFORM" open={showTransform} onToggle={() => setShowTransform((v) => !v)}>
        <div className="prop-row-2col">
          <div className="prop-field">
            <label className="prop-label-sm">X</label>
            <NumberInput value={Math.round(node.x)} onChange={(v) => onUpdate({ x: v })} />
          </div>
          <div className="prop-field">
            <label className="prop-label-sm">Y</label>
            <NumberInput value={Math.round(node.y)} onChange={(v) => onUpdate({ y: v })} />
          </div>
        </div>
        <div className="prop-row-2col">
          <div className="prop-field">
            <label className="prop-label-sm">W</label>
            <NumberInput value={Math.round(node.width)} min={1} onChange={(v) => onUpdate({ width: v })} />
          </div>
          <div className="prop-field">
            <label className="prop-label-sm">H</label>
            <NumberInput value={Math.round(node.height)} min={1} onChange={(v) => onUpdate({ height: v })} />
          </div>
        </div>
        <PropRow label="Rotation">
          <NumberInput value={node.rotation} min={-360} max={360} suffix="°" onChange={(v) => onUpdate({ rotation: v })} />
        </PropRow>
        {(node.type === 'rect' || (node.type === 'group' && node.clipContent !== undefined)) && (
          <PropRow label="Radius">
            <NumberInput value={node.borderRadius ?? 0} min={0} onChange={(v) => onUpdate({ borderRadius: v })} />
          </PropRow>
        )}
      </Accordion>
    </div>
  );
}

const WEIGHT_LABEL: Record<string, string> = {
  '100': 'Thin', '200': 'Extra Light', '300': 'Light', '400': 'Regular', '500': 'Medium',
  '600': 'Semi Bold', '700': 'Bold', '800': 'Extra Bold', '900': 'Black',
};

// ─── Shared Controls ──────────────────────────────────────────────────────────

function Accordion({
  title, open, onToggle, children,
}: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className={`prop-accordion ${open ? 'open' : ''}`}>
      <button className="prop-accordion-header" onClick={onToggle}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        {title}
      </button>
      {open && <div className="prop-accordion-body">{children}</div>}
    </div>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop-row">
      <label className="prop-label">{label}</label>
      <div className="prop-control">{children}</div>
    </div>
  );
}

// Keeps a local draft so clearing the field or typing "-" / "1." does not
// write junk; the value is committed when it parses.
function NumberInput({
  value, min, max, step, suffix, onChange,
}: { value: number; min?: number; max?: number; step?: number; suffix?: string; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  return (
    <div className="prop-number-wrap">
      <input
        className="input"
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        style={{ textAlign: 'right', paddingRight: suffix ? 'var(--spacing-20)' : undefined, paddingBlock: 'var(--spacing-4)' }}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(clamp(v));
        }}
        onBlur={() => setDraft(String(value))}
      />
      {suffix && <span className="prop-number-suffix">{suffix}</span>}
    </div>
  );
}

// The hex field keeps a local draft so half-typed values ("#a1") are never
// written to the slide; only complete #rgb / #rrggbb values are committed.
// Library colors are offered as swatches and keep their library link.
function ColorInput({
  value,
  onChange,
  swatches = [],
  linkedId,
  onPickSwatch,
}: {
  value: string;
  onChange: (v: string) => void;
  swatches?: LibraryColorInfo[];
  linkedId?: string;
  onPickSwatch?: (c: LibraryColorInfo) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const linked = swatches.find((c) => c.id === linkedId);

  return (
    <div className="prop-color">
      <div className="prop-color-wrap">
        <input
          className="prop-color-swatch"
          type="color"
          value={normalizeHex(value) ?? '#000000'}
          onChange={(e) => onChange(e.target.value)}
        />
        {linked ? (
          <span className="prop-color-linked body-xs" title="Linked to a library color">{linked.name}</span>
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
              const hex = normalizeHex(raw);
              if (hex && raw.length === 7) onChange(hex);
            }}
            onBlur={() => {
              const hex = normalizeHex(draft);
              if (hex) onChange(hex);
              else setDraft(value);
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
          />
        )}
      </div>
      {swatches.length > 0 && onPickSwatch && (
        <div className="prop-swatches">
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
    </div>
  );
}

function SegmentButtons<T extends string>({
  value, options, onChange,
}: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="align-buttons">
      {options.map(([v, label]) => (
        <button key={v} className={`align-btn align-btn--text ${value === v ? 'active' : ''}`} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function AlignButtons({
  value, onChange,
}: { value: 'left' | 'center' | 'right'; onChange: (v: 'left' | 'center' | 'right') => void }) {
  return (
    <div className="align-buttons">
      {(['left', 'center', 'right'] as const).map((a) => (
        <button key={a} className={`align-btn ${value === a ? 'active' : ''}`} onClick={() => onChange(a)} title={`Align ${a}`}>
          {a === 'left' && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>}
          {a === 'center' && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="5" y1="18" x2="19" y2="18"/></svg>}
          {a === 'right' && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>}
        </button>
      ))}
    </div>
  );
}
