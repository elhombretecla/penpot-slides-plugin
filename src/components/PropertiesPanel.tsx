import { useState } from 'react';
import { useSlideStore } from '../store';
import type { Slide, SlideNode } from '../types';

interface Props { slide: Slide | null; }

export default function PropertiesPanel({ slide }: Props) {
  const selectedNodeIds = useSlideStore((s) => s.selectedNodeIds);
  const updateNode = useSlideStore((s) => s.updateNode);
  const updateSlide = useSlideStore((s) => s.updateSlide);
  const deleteNode = useSlideStore((s) => s.deleteNode);

  if (!slide) {
    return (
      <div className="properties-panel empty">
        <p className="panel-empty-msg">No slide selected</p>
      </div>
    );
  }

  const selectedNode = selectedNodeIds.length === 1
    ? (slide.nodes.find((n) => n.id === selectedNodeIds[0]) ?? null)
    : null;

  function update(updates: Partial<SlideNode>) {
    if (!slide || !selectedNode) return;
    updateNode(slide.id, selectedNode.id, updates);
  }

  return (
    <div className="properties-panel">
      {!selectedNode ? (
        <SlideProperties
          slide={slide}
          onUpdateBackground={(c) => updateSlide(slide.id, { background: c })}
        />
      ) : (
        <NodeProperties
          node={selectedNode}
          onUpdate={update}
          onDelete={() => { if (slide) deleteNode(slide.id, selectedNode.id); }}
        />
      )}
    </div>
  );
}

// ─── Slide Properties ─────────────────────────────────────────────────────────

function SlideProperties({
  slide,
  onUpdateBackground,
}: {
  slide: Slide;
  onUpdateBackground: (c: string) => void;
}) {
  const updateSlide = useSlideStore((s) => s.updateSlide);
  return (
    <div className="prop-section">
      <div className="prop-section-header">SLIDE</div>

      <PropRow label="Name">
        <input
          className="input input-sm"
          value={slide.name}
          onChange={(e) => updateSlide(slide.id, { name: e.target.value })}
        />
      </PropRow>

      <PropRow label="Size">
        <span className="prop-value-text body-xs">{slide.width} × {slide.height}</span>
      </PropRow>

      <PropRow label="Background">
        <ColorInput value={slide.background} onChange={onUpdateBackground} />
      </PropRow>

      <PropRow label="Source">
        <span className="prop-badge">
          {slide.source === 'library-component' ? 'Library' : 'Custom'}
        </span>
      </PropRow>

      {slide.source === 'library-component' && slide.componentName && (
        <PropRow label="Component">
          <span className="prop-value-text body-xs prop-ellipsis">{slide.componentName}</span>
        </PropRow>
      )}
    </div>
  );
}

// ─── Node Properties ─────────────────────────────────────────────────────────

function NodeProperties({
  node,
  onUpdate,
  onDelete,
}: {
  node: SlideNode;
  onUpdate: (u: Partial<SlideNode>) => void;
  onDelete: () => void;
}) {
  const [showContent, setShowContent] = useState(true);
  const [showTypo, setShowTypo] = useState(true);
  const [showTransform, setShowTransform] = useState(true);

  return (
    <div className="prop-sections">
      <Accordion title="CONTENT" open={showContent} onToggle={() => setShowContent((v) => !v)}>
        <PropRow label="Name">
          <input className="input input-sm" value={node.name} onChange={(e) => onUpdate({ name: e.target.value })} />
        </PropRow>

        {node.type === 'text' && (
          <PropRow label="Body Text">
            <textarea
              className="input"
              style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 'var(--font-size-s)', minHeight: '70px' }}
              value={node.text ?? ''}
              rows={3}
              onChange={(e) => onUpdate({ text: e.target.value })}
            />
          </PropRow>
        )}

        {(node.type === 'rect' || node.type === 'ellipse') && (
          <PropRow label="Fill">
            <ColorInput value={node.fill ?? '#ffffff'} onChange={(v) => onUpdate({ fill: v })} />
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
          <PropRow label="Size">
            <NumberInput value={node.fontSize ?? 16} min={6} max={200} onChange={(v) => onUpdate({ fontSize: v })} />
          </PropRow>

          <PropRow label="Weight">
            <select
              className="select"
              style={{ blockSize: '28px', fontSize: 'var(--font-size-xs)' }}
              value={node.fontWeight ?? '400'}
              onChange={(e) => onUpdate({ fontWeight: e.target.value })}
            >
              <option value="300">Light</option>
              <option value="400">Regular</option>
              <option value="500">Medium</option>
              <option value="600">Semi Bold</option>
              <option value="700">Bold</option>
              <option value="900">Black</option>
            </select>
          </PropRow>

          <PropRow label="Color">
            <ColorInput value={node.fontColor ?? '#ffffff'} onChange={(v) => onUpdate({ fontColor: v })} />
          </PropRow>

          <PropRow label="Align">
            <AlignButtons
              value={node.textAlign ?? 'left'}
              onChange={(v) => onUpdate({ textAlign: v })}
            />
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
        {node.type === 'rect' && (
          <PropRow label="Radius">
            <NumberInput value={node.borderRadius ?? 0} min={0} onChange={(v) => onUpdate({ borderRadius: v })} />
          </PropRow>
        )}
      </Accordion>
    </div>
  );
}

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

function NumberInput({
  value, min, max, suffix, onChange,
}: { value: number; min?: number; max?: number; suffix?: string; onChange: (v: number) => void }) {
  return (
    <div className="prop-number-wrap">
      <input
        className="input"
        type="number"
        value={value}
        min={min}
        max={max}
        style={{ textAlign: 'right', paddingRight: suffix ? 'var(--spacing-20)' : undefined, paddingBlock: 'var(--spacing-4)' }}
        onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
      />
      {suffix && <span className="prop-number-suffix">{suffix}</span>}
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="prop-color-wrap">
      <input
        className="prop-color-swatch"
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        className="input"
        type="text"
        value={value}
        maxLength={7}
        style={{ width: '80px', fontFamily: 'monospace', fontSize: 'var(--font-size-xs)', paddingBlock: 'var(--spacing-4)' }}
        onChange={(e) => { const v = e.target.value; if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v); }}
      />
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`toggle ${value ? 'on' : 'off'}`}
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
    >
      <span className="toggle-thumb" />
    </button>
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
