import { useEffect } from 'react';
import { useSlideStore } from '../store';
import { penpotApi } from '../api';

export default function HomeScreen() {
  const setScreen = useSlideStore((s) => s.setScreen);
  const libraries = useSlideStore((s) => s.libraries);
  const setLibrariesLoading = useSlideStore((s) => s.setLibrariesLoading);
  const librariesLoading = useSlideStore((s) => s.librariesLoading);
  const setShowNewSlideModal = useSlideStore((s) => s.setShowNewSlideModal);
  const addSlides = useSlideStore((s) => s.addSlides);

  useEffect(() => {
    setLibrariesLoading(true);
    penpotApi.getLibraries();
  }, [setLibrariesLoading]);

  function handleNewPresentation() {
    addSlides([]);
    setScreen('slide-manager');
    setShowNewSlideModal(true);
  }

  return (
    <div className="home-screen">
      {/* Header */}
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
      </div>

      <div className="home-body">
        {/* Left column – actions */}
        <div className="home-left">
          <p className="headline-s home-section-label">Get Started</p>

          <button
            data-appearance="primary"
            className="home-cta-btn"
            onClick={handleNewPresentation}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Presentation
          </button>

          <button
            data-appearance="secondary"
            className="home-cta-btn"
            onClick={() => setScreen('library-picker')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="8" height="8" rx="1"/>
              <rect x="13" y="3" width="8" height="8" rx="1"/>
              <rect x="3" y="13" width="8" height="8" rx="1"/>
            </svg>
            Import from Library
          </button>
        </div>

        {/* Right column – Connected Libraries */}
        <div className="home-right">
          <p className="headline-s home-section-label">Connected Libraries</p>

          {librariesLoading ? (
            <div className="home-loading">
              <div className="spinner" />
              <span className="body-s">Loading libraries…</span>
            </div>
          ) : libraries.length === 0 ? (
            <div className="home-empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <path d="M8 21h8M12 17v4"/>
              </svg>
              <p className="body-s home-empty-title">No libraries connected yet.</p>
              <p className="body-xs home-empty-hint">Connect shared libraries in Penpot to use components as slide templates.</p>
            </div>
          ) : (
            <div className="library-list">
              {libraries.map((lib) => (
                <button
                  key={lib.id}
                  className="library-list-item"
                  onClick={() => {
                    useSlideStore.getState().setActiveLibraryId(lib.id);
                    setScreen('library-picker');
                  }}
                >
                  <span className="library-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="8" height="8" rx="1"/>
                      <rect x="13" y="3" width="8" height="8" rx="1"/>
                      <rect x="3" y="13" width="8" height="8" rx="1"/>
                      <rect x="13" y="13" width="8" height="8" rx="1"/>
                    </svg>
                  </span>
                  <span className="library-info">
                    <span className="library-name">{lib.name}</span>
                    <span className="library-meta">{lib.numComponents} components</span>
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
