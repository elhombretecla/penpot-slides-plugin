import { useState } from 'react';
import { useSlideStore } from '../store';
import { createSlideWithLayout } from '../utils';
import type { PresetLayout, SlideSizePreset } from '../types';
import { SLIDE_SIZE_PRESETS } from '../types';

const BACKGROUND_PRESETS = ['#18181a', '#ffffff', '#2e3434', '#212426'];

const PRESET_LAYOUTS: { id: PresetLayout; label: string; icon: React.ReactNode }[] = [
  {
    id: 'empty',
    label: 'Empty',
    icon: (
      <svg width="32" height="22" viewBox="0 0 32 22" fill="none">
        <rect x="1" y="1" width="30" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <circle cx="16" cy="11" r="2" fill="currentColor" opacity="0.25"/>
      </svg>
    ),
  },
  {
    id: 'title-only',
    label: 'Title Only',
    icon: (
      <svg width="32" height="22" viewBox="0 0 32 22" fill="none">
        <rect x="1" y="1" width="30" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <line x1="6" y1="11" x2="26" y2="11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'title-text',
    label: 'Title + Text',
    icon: (
      <svg width="32" height="22" viewBox="0 0 32 22" fill="none">
        <rect x="1" y="1" width="30" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <line x1="4" y1="7" x2="28" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        <line x1="4" y1="12" x2="28" y2="12" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
        <line x1="4" y1="16" x2="20" y2="16" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
      </svg>
    ),
  },
  {
    id: 'two-columns',
    label: 'Two Columns',
    icon: (
      <svg width="32" height="22" viewBox="0 0 32 22" fill="none">
        <rect x="1" y="1" width="30" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <rect x="3" y="7" width="12" height="13" rx="1" fill="currentColor" opacity="0.15"/>
        <rect x="17" y="7" width="12" height="13" rx="1" fill="currentColor" opacity="0.15"/>
        <line x1="4" y1="4.5" x2="28" y2="4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'image-caption',
    label: 'Image + Caption',
    icon: (
      <svg width="32" height="22" viewBox="0 0 32 22" fill="none">
        <rect x="1" y="1" width="30" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <rect x="3" y="3" width="26" height="13" rx="1" fill="currentColor" opacity="0.15"/>
        <line x1="4" y1="19" x2="28" y2="19" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
      </svg>
    ),
  },
];

const SIZE_OPTIONS: { id: SlideSizePreset; label: string }[] = [
  { id: '16:9', label: '16:9 (Standard)' },
  { id: '4:3', label: '4:3' },
  { id: 'custom', label: 'Custom' },
];

export default function NewSlideModal() {
  const setShowNewSlideModal = useSlideStore((s) => s.setShowNewSlideModal);
  const addSlide = useSlideStore((s) => s.addSlide);
  const slides = useSlideStore((s) => s.slides);

  const [selectedSize, setSelectedSize] = useState<SlideSizePreset>('16:9');
  const [selectedLayout, setSelectedLayout] = useState<PresetLayout>('empty');
  const [background, setBackground] = useState('#18181a');
  const [customW, setCustomW] = useState(800);
  const [customH, setCustomH] = useState(600);

  const displaySize = selectedSize === 'custom'
    ? `${customW} × ${customH}`
    : `${SLIDE_SIZE_PRESETS[selectedSize].width} × ${SLIDE_SIZE_PRESETS[selectedSize].height}`;

  function handleCreate() {
    const slideNum = slides.length + 1;
    const name = `Slide ${String(slideNum).padStart(2, '0')}`;
    const slide = createSlideWithLayout(
      name, selectedSize, background, selectedLayout,
      selectedSize === 'custom' ? customW : undefined,
      selectedSize === 'custom' ? customH : undefined
    );
    addSlide(slide);
    setShowNewSlideModal(false);
  }

  return (
    <div className="modal-overlay" onClick={() => setShowNewSlideModal(false)}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <span className="modal-header-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </span>
          <span className="title-s">Create New Slide</span>
          <button className="btn-icon modal-close" onClick={() => setShowNewSlideModal(false)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="modal-body">
          {/* Left */}
          <div className="modal-left">
            {/* Slide Size */}
            <div className="modal-section">
              <span className="headline-s">SLIDE SIZE</span>
              <div className="size-options">
                {SIZE_OPTIONS.map(({ id, label }) => (
                  <button
                    key={id}
                    className={`size-option ${selectedSize === id ? 'active' : ''}`}
                    onClick={() => setSelectedSize(id)}
                  >
                    <div className="size-option-preview">
                      {id === '16:9' && (
                        <svg width="34" height="22" viewBox="0 0 34 22" fill="none">
                          <rect x="1" y="1" width="32" height="20" rx="2" stroke="currentColor" strokeWidth="1.5"
                            fill={selectedSize === id ? 'currentColor' : 'none'} fillOpacity="0.1"/>
                        </svg>
                      )}
                      {id === '4:3' && (
                        <svg width="28" height="22" viewBox="0 0 28 22" fill="none">
                          <rect x="1" y="1" width="26" height="20" rx="2" stroke="currentColor" strokeWidth="1.5"
                            fill={selectedSize === id ? 'currentColor' : 'none'} fillOpacity="0.1"/>
                        </svg>
                      )}
                      {id === 'custom' && (
                        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                          <rect x="1" y="1" width="20" height="20" rx="2" stroke="currentColor" strokeWidth="1.5"
                            fill={selectedSize === id ? 'currentColor' : 'none'} fillOpacity="0.1"/>
                          <path d="M7 11h8M11 7v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      )}
                    </div>
                    <span className="size-option-label">{label}</span>
                  </button>
                ))}
              </div>

              {selectedSize === 'custom' && (
                <div className="custom-size-inputs">
                  <div className="prop-row-2col">
                    <div className="prop-field">
                      <label className="prop-label-sm">Width</label>
                      <input className="input" type="number" value={customW} min={100} max={4096}
                        style={{ paddingBlock: 'var(--spacing-4)' }}
                        onChange={(e) => setCustomW(parseInt(e.target.value) || 800)} />
                    </div>
                    <div className="prop-field">
                      <label className="prop-label-sm">Height</label>
                      <input className="input" type="number" value={customH} min={100} max={4096}
                        style={{ paddingBlock: 'var(--spacing-4)' }}
                        onChange={(e) => setCustomH(parseInt(e.target.value) || 600)} />
                    </div>
                  </div>
                </div>
              )}

              <p className="size-display">{displaySize} px</p>
            </div>

            {/* Background Color */}
            <div className="modal-section">
              <span className="headline-s">BACKGROUND COLOR</span>
              <div className="bg-presets">
                {BACKGROUND_PRESETS.map((color) => (
                  <button
                    key={color}
                    className={`bg-preset ${background === color ? 'active' : ''}`}
                    style={{ background: color }}
                    onClick={() => setBackground(color)}
                    title={color}
                  />
                ))}
                <label className="bg-preset-custom" title="Custom color">
                  <input type="color" value={background} onChange={(e) => setBackground(e.target.value)}
                    style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }} />
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--foreground-secondary)' }}>
                    <circle cx="12" cy="12" r="9"/>
                    <path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" opacity="0.2"/>
                  </svg>
                </label>
              </div>
            </div>
          </div>

          {/* Right – Preset Layouts */}
          <div className="modal-right">
            <div className="modal-section">
              <span className="headline-s">PRESET LAYOUTS</span>
              <div className="layout-grid">
                {PRESET_LAYOUTS.map(({ id, label, icon }) => (
                  <button
                    key={id}
                    className={`layout-option ${selectedLayout === id ? 'active' : ''}`}
                    onClick={() => setSelectedLayout(id)}
                  >
                    <div className="layout-preview" style={{ background }}>
                      {icon}
                    </div>
                    <span className="layout-label">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button data-appearance="secondary" onClick={() => setShowNewSlideModal(false)}>
            Cancel
          </button>
          <button data-appearance="primary" onClick={handleCreate}>
            Create Slide
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
