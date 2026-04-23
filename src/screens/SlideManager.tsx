import { useState, useRef, useEffect } from 'react';
import { useSlideStore } from '../store';
import SlideList from '../components/SlideList';
import SlideCanvas from '../components/SlideCanvas';
import PropertiesPanel from '../components/PropertiesPanel';
import LayersPanel from '../components/LayersPanel';
import ExportPanel from '../components/ExportPanel';

export default function SlideManager() {
  const setScreen = useSlideStore((s) => s.setScreen);
  const slides = useSlideStore((s) => s.slides);
  const activeSlideId = useSlideStore((s) => s.activeSlideId);
  const setShowNewSlideModal = useSlideStore((s) => s.setShowNewSlideModal);
  const setShowExportPanel = useSlideStore((s) => s.setShowExportPanel);
  const showExportPanel = useSlideStore((s) => s.showExportPanel);
  const sidePanel = useSlideStore((s) => s.sidePanel);
  const setSidePanel = useSlideStore((s) => s.setSidePanel);

  const activeSlide = slides.find((s) => s.id === activeSlideId) ?? null;

  return (
    <div className="slide-manager">
      {/* Top bar */}
      <div className="manager-topbar">
        <button className="btn-icon" onClick={() => setScreen('home')} title="Back to Home">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>

        <span className="title-s manager-title">Slide Builder</span>

        <div className="manager-topbar-actions">
          <button
            data-appearance="secondary"
            onClick={() => setScreen('library-picker')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="8" height="8" rx="1"/>
              <rect x="13" y="3" width="8" height="8" rx="1"/>
              <rect x="3" y="13" width="8" height="8" rx="1"/>
            </svg>
            Library
          </button>

          <button
            data-appearance="primary"
            onClick={() => setShowExportPanel(true)}
            disabled={slides.length === 0}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Export
          </button>
        </div>
      </div>

      <div className="manager-body">
        {/* Slide list */}
        <div className="manager-slide-list">
          <SlideList />
          <AddSlideMenu
            onAddNew={() => setShowNewSlideModal(true)}
            onAddFromLibrary={() => setScreen('library-picker')}
          />
        </div>

        {/* Center canvas */}
        <div className="manager-canvas-area">
          {slides.length === 0 ? (
            <div className="manager-empty-state">
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.25">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
              <p className="body-s">No slides yet</p>
              <p className="body-xs">Add a slide to get started</p>
              <button
                data-appearance="primary"
                onClick={() => setShowNewSlideModal(true)}
                style={{ marginTop: 'var(--spacing-8)' }}
              >
                Create First Slide
              </button>
            </div>
          ) : (
            <SlideCanvas slide={activeSlide} />
          )}
        </div>

        {/* Right panel */}
        <div className="manager-right-panel">
          <div className="panel-tabs">
            <button
              className={`panel-tab ${sidePanel === 'properties' ? 'active' : ''}`}
              onClick={() => setSidePanel('properties')}
            >
              Properties
            </button>
            <button
              className={`panel-tab ${sidePanel === 'layers' ? 'active' : ''}`}
              onClick={() => setSidePanel('layers')}
            >
              Layers
            </button>
          </div>
          {sidePanel === 'properties'
            ? <PropertiesPanel slide={activeSlide} />
            : <LayersPanel slide={activeSlide} />}
        </div>
      </div>

      {/* Export overlay */}
      {showExportPanel && <ExportOverlay />}
    </div>
  );
}

interface AddSlideMenuProps {
  onAddNew: () => void;
  onAddFromLibrary: () => void;
}

function AddSlideMenu({ onAddNew, onAddFromLibrary }: AddSlideMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div className="add-slide-menu-root" ref={ref}>
      {open && (
        <div className="add-slide-menu">
          <button
            className="add-slide-menu-item"
            onClick={() => { setOpen(false); onAddNew(); }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <line x1="12" y1="21" x2="12" y2="17"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
            </svg>
            Add new slide
          </button>
          <button
            className="add-slide-menu-item"
            onClick={() => { setOpen(false); onAddFromLibrary(); }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="8" height="8" rx="1"/>
              <rect x="13" y="3" width="8" height="8" rx="1"/>
              <rect x="3" y="13" width="8" height="8" rx="1"/>
            </svg>
            Add from library
          </button>
        </div>
      )}
      <button
        className="add-slide-btn"
        onClick={() => setOpen((v) => !v)}
        title="Add Slide"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
    </div>
  );
}

function ExportOverlay() {
  const setShowExportPanel = useSlideStore((s) => s.setShowExportPanel);
  return (
    <div className="export-overlay" onClick={() => setShowExportPanel(false)}>
      <div className="export-overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div className="export-overlay-header">
          <span className="headline-s" style={{ color: 'var(--foreground-primary)' }}>Export Options</span>
          <button className="btn-icon" onClick={() => setShowExportPanel(false)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <ExportPanel />
      </div>
    </div>
  );
}
