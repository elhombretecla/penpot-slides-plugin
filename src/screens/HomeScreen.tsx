import { useEffect, useState } from 'react';
import { useSlideStore } from '../store';
import { penpotApi } from '../api';
import type { DeckSummary, LibraryInfo } from '../types';

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function HomeScreen() {
  const libraries = useSlideStore((s) => s.libraries);
  const librariesLoading = useSlideStore((s) => s.librariesLoading);
  const setLibrariesLoading = useSlideStore((s) => s.setLibrariesLoading);
  const decks = useSlideStore((s) => s.decks);
  const decksLoaded = useSlideStore((s) => s.decksLoaded);
  const fileName = useSlideStore((s) => s.fileName);
  const newDeck = useSlideStore((s) => s.newDeck);
  const setScreen = useSlideStore((s) => s.setScreen);
  const setShowNewSlideModal = useSlideStore((s) => s.setShowNewSlideModal);
  const openPicker = useSlideStore((s) => s.openPicker);

  useEffect(() => {
    setLibrariesLoading(true);
    penpotApi.getLibraries();
    penpotApi.listDecks();
  }, [setLibrariesLoading]);

  function handleBlank() {
    newDeck('Untitled presentation');
    setScreen('slide-manager');
    setShowNewSlideModal(true);
  }

  function handleFromLibrary(lib?: LibraryInfo) {
    const target = lib ?? libraries.find((l) => l.numSlides > 0) ?? libraries[0];
    openPicker({ kind: 'new-deck' }, target?.id ?? null);
  }

  return (
    <div className="home-screen">
      <div className="home-header">
        <span className="home-logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="3" width="9" height="6" rx="1.5" fill="currentColor" opacity="0.9"/>
            <rect x="13" y="3" width="9" height="6" rx="1.5" fill="currentColor" opacity="0.5"/>
            <rect x="2" y="11" width="9" height="6" rx="1.5" fill="currentColor" opacity="0.5"/>
            <rect x="13" y="11" width="9" height="6" rx="1.5" fill="currentColor" opacity="0.3"/>
          </svg>
        </span>
        <span className="title-s" style={{ color: 'var(--foreground-primary)' }}>Slide Builder</span>
        {fileName && <span className="body-xs home-file-name" title={fileName}>· {fileName}</span>}
      </div>

      <div className="home-body">
        <div className="home-left">
          <p className="headline-s home-section-label">New presentation</p>

          <button className="home-start-card" onClick={handleBlank}>
            <span className="home-start-preview home-start-preview--blank">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </span>
            <span className="home-start-text">
              <span className="body-s home-start-title">Blank</span>
              <span className="body-xs home-start-hint">Start from simple layouts</span>
            </span>
          </button>

          <button
            className="home-start-card"
            onClick={() => handleFromLibrary()}
            disabled={libraries.length === 0}
            title={libraries.length === 0 ? 'Connect a library with slide components first' : undefined}
          >
            <span className="home-start-preview home-start-preview--template">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/>
                <rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>
              </svg>
            </span>
            <span className="home-start-text">
              <span className="body-s home-start-title">From a template library</span>
              <span className="body-xs home-start-hint">Use library components as slide layouts</span>
            </span>
          </button>

          <p className="headline-s home-section-label home-section-label--spaced">Template libraries</p>
          {librariesLoading ? (
            <div className="home-loading">
              <div className="spinner spinner--sm" />
              <span className="body-xs">Loading libraries…</span>
            </div>
          ) : (
            <div className="library-list">
              {libraries.map((lib) => (
                <button key={lib.id} className="library-list-item" onClick={() => handleFromLibrary(lib)}>
                  <span className="library-info">
                    <span className="library-name">{lib.name}</span>
                    <span className="library-meta">
                      {lib.numSlides > 0
                        ? `${lib.numSlides} slide layout${lib.numSlides !== 1 ? 's' : ''} · ${lib.numComponents - lib.numSlides} elements`
                        : `${lib.numComponents} components, no slide layouts`}
                    </span>
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </button>
              ))}
              {libraries.length === 0 && (
                <p className="body-xs home-empty-hint">No library in this file has components yet.</p>
              )}
              <TeamLibraries />
            </div>
          )}
        </div>

        <div className="home-right">
          <p className="headline-s home-section-label">Presentations in this file</p>
          {!decksLoaded ? (
            <div className="home-loading">
              <div className="spinner" />
            </div>
          ) : decks.length === 0 ? (
            <div className="home-empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <path d="M8 21h8M12 17v4"/>
              </svg>
              <p className="body-s home-empty-title">No presentations yet</p>
              <p className="body-xs home-empty-hint">
                Presentations are saved inside this Penpot file, so they are here every time you open the plugin.
              </p>
            </div>
          ) : (
            <div className="deck-list">
              {decks.map((d) => (
                <DeckRow key={d.id} deck={d} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DeckRow({ deck }: { deck: DeckSummary }) {
  const [confirming, setConfirming] = useState(false);
  const ratio = deck.width / Math.max(1, deck.height);
  return (
    <div className="deck-row">
      <button className="deck-row-main" onClick={() => penpotApi.loadDeck(deck.id)}>
        <span className="deck-row-thumb" style={{ aspectRatio: String(ratio) }}>
          <span className="body-xs">{deck.slideCount}</span>
        </span>
        <span className="deck-row-info">
          <span className="body-s deck-row-name">{deck.name}</span>
          <span className="body-xs deck-row-meta">
            {deck.slideCount} slide{deck.slideCount !== 1 ? 's' : ''}
            {deck.libraryName ? ` · ${deck.libraryName}` : ''} · {relativeTime(deck.updatedAt)}
          </span>
        </span>
      </button>
      {confirming ? (
        <span className="deck-row-confirm">
          <button className="btn-link btn-link--danger" onClick={() => penpotApi.deleteDeck(deck.id)}>
            Delete
          </button>
          <button className="btn-link" onClick={() => setConfirming(false)}>Cancel</button>
        </span>
      ) : (
        <button className="btn-icon btn-icon-sm btn-danger deck-row-delete" onClick={() => setConfirming(true)} title="Delete presentation">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          </svg>
        </button>
      )}
    </div>
  );
}

// Shared libraries of the team that this file is not using yet.
function TeamLibraries() {
  const available = useSlideStore((s) => s.availableLibraries);
  const setAvailable = useSlideStore((s) => s.setAvailableLibraries);
  const [open, setOpen] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        className="btn-link home-team-toggle"
        onClick={() => {
          setOpen(true);
          setAvailable(null);
          penpotApi.getAvailableLibraries();
        }}
      >
        + Connect a team library…
      </button>
    );
  }

  return (
    <div className="team-libraries">
      {available === null ? (
        <div className="home-loading">
          <div className="spinner spinner--sm" />
          <span className="body-xs">Looking for shared libraries…</span>
        </div>
      ) : available.length === 0 ? (
        <p className="body-xs home-empty-hint">No other shared libraries with components in your teams.</p>
      ) : (
        available.map((lib) => (
          <div key={lib.id} className="team-library-row">
            <span className="body-xs team-library-name">{lib.name}</span>
            <span className="body-xs team-library-meta">{lib.numComponents}</span>
            <button
              data-appearance="secondary"
              className="team-library-connect"
              disabled={connecting === lib.id}
              onClick={() => {
                setConnecting(lib.id);
                penpotApi.connectLibrary(lib.id);
              }}
            >
              {connecting === lib.id ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        ))
      )}
      <button className="btn-link" onClick={() => setOpen(false)}>Close</button>
    </div>
  );
}
