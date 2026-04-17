import { useState } from 'react';
import { useSlideStore } from '../store';
import SlideList from '../components/SlideList';
import SlideCanvas from '../components/SlideCanvas';
import PropertiesPanel from '../components/PropertiesPanel';
import LayersPanel from '../components/LayersPanel';
import ExportPanel from '../components/ExportPanel';

type NavTab = 'editor' | 'layers' | 'config';

export default function SlideManager() {
  const setScreen = useSlideStore((s) => s.setScreen);
  const slides = useSlideStore((s) => s.slides);
  const activeSlideId = useSlideStore((s) => s.activeSlideId);
  const setShowNewSlideModal = useSlideStore((s) => s.setShowNewSlideModal);
  const setShowExportPanel = useSlideStore((s) => s.setShowExportPanel);
  const showExportPanel = useSlideStore((s) => s.showExportPanel);
  const sidePanel = useSlideStore((s) => s.sidePanel);
  const setSidePanel = useSlideStore((s) => s.setSidePanel);

  const [navTab, setNavTab] = useState<NavTab>('editor');
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
        {/* Left nav */}
        <nav className="manager-nav">
          <button
            className={`manager-nav-btn ${navTab === 'editor' ? 'active' : ''}`}
            onClick={() => setNavTab('editor')}
            title="Editor"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            <span>EDITOR</span>
          </button>
          <button
            className={`manager-nav-btn ${navTab === 'layers' ? 'active' : ''}`}
            onClick={() => setNavTab('layers')}
            title="Layers"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 2 7 12 12 22 7 12 2"/>
              <polyline points="2 17 12 22 22 17"/>
              <polyline points="2 12 12 17 22 12"/>
            </svg>
            <span>LAYERS</span>
          </button>
          <button
            className={`manager-nav-btn ${navTab === 'config' ? 'active' : ''}`}
            onClick={() => { setNavTab('config'); setShowExportPanel(true); }}
            title="Export Config"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
            </svg>
            <span>CONFIG</span>
          </button>
        </nav>

        {/* Slide list */}
        <div className="manager-slide-list">
          <SlideList />
          <button
            className="add-slide-btn"
            onClick={() => setShowNewSlideModal(true)}
            title="Add Slide"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
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
          {navTab === 'editor' && (
            <>
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
            </>
          )}

          {navTab === 'layers' && (
            <>
              <div className="panel-tabs">
                <button className="panel-tab active">Layers</button>
              </div>
              <LayersPanel slide={activeSlide} />
            </>
          )}

          {navTab === 'config' && showExportPanel && (
            <>
              <div className="panel-tabs">
                <button className="panel-tab active">Export</button>
              </div>
              <ExportPanel />
            </>
          )}
        </div>
      </div>

      {/* Export overlay (when triggered from topbar) */}
      {showExportPanel && navTab !== 'config' && <ExportOverlay />}
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
