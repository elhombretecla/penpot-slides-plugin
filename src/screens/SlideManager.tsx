import { useState, useRef, useEffect } from 'react';
import { useSlideStore } from '../store';
import { penpotApi } from '../api';
import { flushSave } from '../autosave';
import { applyTemplates, itemFromComponent } from '../templateActions';
import SlideList from '../components/SlideList';
import SlideCanvas from '../components/SlideCanvas';
import PropertiesPanel from '../components/PropertiesPanel';
import LayersPanel from '../components/LayersPanel';
import InsertPanel from '../components/InsertPanel';
import ExportPanel from '../components/ExportPanel';
import Thumbnail from '../components/Thumbnail';
import RenderToggle from '../components/RenderToggle';

export default function SlideManager() {
  const slides = useSlideStore((s) => s.slides);
  const activeSlideId = useSlideStore((s) => s.activeSlideId);
  const setShowNewSlideModal = useSlideStore((s) => s.setShowNewSlideModal);
  const setShowExportPanel = useSlideStore((s) => s.setShowExportPanel);
  const showExportPanel = useSlideStore((s) => s.showExportPanel);
  const sidePanel = useSlideStore((s) => s.sidePanel);
  const setSidePanel = useSlideStore((s) => s.setSidePanel);
  const deck = useSlideStore((s) => s.deck);
  const requestCatalog = useSlideStore((s) => s.requestCatalog);
  const hasCatalog = useSlideStore((s) => !!(s.deck?.libraryId && s.catalogs[s.deck.libraryId]));

  const activeSlide = slides.find((s) => s.id === activeSlideId) ?? null;

  // The deck's library feeds the "New slide" layouts, styles and elements.
  useEffect(() => {
    if (deck?.libraryId && !hasCatalog) requestCatalog(deck.libraryId);
  }, [deck?.libraryId, hasCatalog, requestCatalog]);

  function handleBack() {
    flushSave();
    useSlideStore.getState().closeDeck();
    penpotApi.listDecks();
  }

  return (
    <div className="slide-manager">
      <div className="manager-topbar">
        <button className="btn-icon" onClick={handleBack} title="All presentations">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>

        <DeckTitle />
        <SaveIndicator />

        <div className="manager-topbar-actions">
          <RenderToggle slide={activeSlide} />
          <button
            data-appearance="primary"
            onClick={() => setShowExportPanel(true)}
            disabled={slides.length === 0}
            title="Create the slides as boards in this Penpot file"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>
            </svg>
            Insert into Penpot
          </button>
        </div>
      </div>

      <div className="manager-body">
        <div className="manager-slide-list">
          <SlideList />
          <AddSlideMenu />
        </div>

        <div className="manager-canvas-area">
          {slides.length === 0 ? (
            <div className="manager-empty-state">
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.25">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
              <p className="body-s">No slides yet</p>
              <div className="manager-empty-actions">
                <button data-appearance="primary" onClick={() => setShowNewSlideModal(true)}>
                  Blank slide
                </button>
                <button
                  data-appearance="secondary"
                  onClick={() => useSlideStore.getState().openPicker({ kind: 'add-slides', afterSlideId: null })}
                >
                  From a library
                </button>
              </div>
            </div>
          ) : (
            <>
              <SlideCanvas slide={activeSlide} />
              {activeSlide && <SpeakerNotes key={activeSlide.id} slideId={activeSlide.id} />}
            </>
          )}
        </div>

        <div className="manager-right-panel">
          <div className="panel-tabs">
            {(['properties', 'layers', 'insert'] as const).map((tab) => (
              <button
                key={tab}
                className={`panel-tab ${sidePanel === tab ? 'active' : ''}`}
                onClick={() => setSidePanel(tab)}
              >
                {tab === 'properties' ? 'Design' : tab === 'layers' ? 'Layers' : 'Insert'}
              </button>
            ))}
          </div>
          {sidePanel === 'properties' && <PropertiesPanel slide={activeSlide} />}
          {sidePanel === 'layers' && <LayersPanel slide={activeSlide} />}
          {sidePanel === 'insert' && <InsertPanel slide={activeSlide} />}
        </div>
      </div>

      {showExportPanel && <ExportOverlay />}
    </div>
  );
}

function DeckTitle() {
  const deck = useSlideStore((s) => s.deck);
  const updateDeck = useSlideStore((s) => s.updateDeck);
  const [draft, setDraft] = useState(deck?.name ?? '');
  useEffect(() => setDraft(deck?.name ?? ''), [deck?.name]);
  if (!deck) return null;
  return (
    <input
      className="deck-title-input title-s"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const name = draft.trim() || 'Untitled presentation';
        setDraft(name);
        if (name !== deck.name) updateDeck({ name });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(deck.name);
          e.currentTarget.blur();
        }
      }}
      title="Rename presentation"
    />
  );
}

function SaveIndicator() {
  const status = useSlideStore((s) => s.saveStatus);
  const error = useSlideStore((s) => s.saveError);
  const label =
    status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Unsaved changes' : status === 'error' ? 'Not saved' : 'Saved in file';
  return (
    <span className={`save-indicator save-indicator--${status}`} title={error ?? 'Presentations are stored inside this Penpot file'}>
      <span className="save-indicator-dot" />
      {label}
    </span>
  );
}

function SpeakerNotes({ slideId }: { slideId: string }) {
  const notes = useSlideStore((s) => s.slides.find((x) => x.id === slideId)?.notes ?? '');
  const updateSlide = useSlideStore((s) => s.updateSlide);
  const commitHistoryCoalesced = useSlideStore((s) => s.commitHistoryCoalesced);
  return (
    <textarea
      className="speaker-notes body-s"
      placeholder="Speaker notes…"
      value={notes}
      rows={2}
      onChange={(e) => {
        commitHistoryCoalesced(`slide:${slideId}:notes`);
        updateSlide(slideId, { notes: e.target.value });
      }}
    />
  );
}

// "New slide" menu: blank layouts plus every slide layout of the deck's
// library, inserted right after the current slide (Google Slides style).
function AddSlideMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const deck = useSlideStore((s) => s.deck);
  const catalog = useSlideStore((s) => (s.deck?.libraryId ? s.catalogs[s.deck.libraryId] : undefined));
  const thumbnails = useSlideStore((s) => s.thumbnailsMap);
  const activeSlideId = useSlideStore((s) => s.activeSlideId);
  const setShowNewSlideModal = useSlideStore((s) => s.setShowNewSlideModal);
  const openPicker = useSlideStore((s) => s.openPicker);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const layouts = (catalog?.components ?? []).filter((c) => c.kind === 'slide');

  return (
    <div className="add-slide-menu-root" ref={ref}>
      {open && (
        <div className="add-slide-menu">
          {layouts.length > 0 && (
            <>
              <span className="add-slide-menu-label">{deck?.libraryName ?? 'Library'} layouts</span>
              <div className="add-slide-layouts">
                {layouts.map((c) => (
                  <button
                    key={c.id}
                    className="add-slide-layout"
                    title={c.name}
                    onClick={() => {
                      setOpen(false);
                      applyTemplates([itemFromComponent(c)], { kind: 'add-slides', insertAfterSlideId: activeSlideId });
                    }}
                  >
                    {thumbnails[c.id] ? (
                      <Thumbnail src={thumbnails[c.id]} />
                    ) : (
                      <span className="add-slide-layout-placeholder" />
                    )}
                    <span className="add-slide-layout-name">{c.name}</span>
                  </button>
                ))}
              </div>
              <div className="add-slide-menu-divider" />
            </>
          )}
          <button className="add-slide-menu-item" onClick={() => { setOpen(false); setShowNewSlideModal(true); }}>
            Blank slide…
          </button>
          <button
            className="add-slide-menu-item"
            onClick={() => { setOpen(false); openPicker({ kind: 'add-slides', afterSlideId: activeSlideId }); }}
          >
            Browse libraries…
          </button>
        </div>
      )}
      <button className="add-slide-btn" onClick={() => setOpen((v) => !v)} title="New slide">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span className="body-xs">New slide</span>
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
          <span className="headline-s" style={{ color: 'var(--foreground-primary)' }}>Insert into Penpot</span>
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
