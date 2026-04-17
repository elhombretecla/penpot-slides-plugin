import { useSlideStore } from '../store';
import { penpotApi } from '../api';

export default function ExportPanel() {
  const slides = useSlideStore((s) => s.slides);
  const exportSettings = useSlideStore((s) => s.exportSettings);
  const setExportSettings = useSlideStore((s) => s.setExportSettings);
  const isInserting = useSlideStore((s) => s.isInserting);
  const setIsInserting = useSlideStore((s) => s.setIsInserting);
  const insertResult = useSlideStore((s) => s.insertResult);
  const setInsertResult = useSlideStore((s) => s.setInsertResult);
  const setShowExportPanel = useSlideStore((s) => s.setShowExportPanel);

  function handleInsert() {
    if (slides.length === 0) return;
    setIsInserting(true);
    setInsertResult(null);
    penpotApi.insertIntoCanvas(slides, exportSettings);
  }

  return (
    <div className="export-panel">
      {/* Info box */}
      <div className="export-info-box">
        <span className="body-s" style={{ color: 'var(--foreground-primary)', fontWeight: 'var(--font-weight-bold)' }}>
          Export Options
        </span>
        <span className="export-info-badge">Total: {slides.length} Slides</span>
        <p className="export-info-desc">
          Slides will be arranged horizontally on the canvas.
        </p>
      </div>

      {/* Settings */}
      <div className="export-settings">
        {/* Spacing */}
        <p className="headline-s" style={{ color: 'var(--foreground-secondary)', padding: 'var(--spacing-8) 0 var(--spacing-4)' }}>
          Spacing between boards (px)
        </p>
        <div className="export-spacing-input">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--foreground-secondary)', flexShrink: 0 }}>
            <path d="M21 3H3M21 21H3"/>
          </svg>
          <input
            className="input"
            type="number"
            value={exportSettings.spacing}
            min={0}
            max={2000}
            style={{ background: 'transparent', border: 'none', outline: 'none', paddingBlock: 0, flex: 1 }}
            onChange={(e) => setExportSettings({ spacing: parseInt(e.target.value) || 0 })}
          />
        </div>

        <div className="export-divider" />

        {/* Group into Section */}
        <div className="export-setting-row">
          <div className="export-setting-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="8" height="8" rx="1"/>
              <rect x="13" y="3" width="8" height="8" rx="1"/>
              <rect x="3" y="13" width="8" height="8" rx="1"/>
              <rect x="13" y="13" width="8" height="8" rx="1"/>
            </svg>
            <span className="body-s">Group into Section</span>
          </div>
          <button
            className={`toggle ${exportSettings.groupIntoSection ? 'on' : 'off'}`}
            onClick={() => setExportSettings({ groupIntoSection: !exportSettings.groupIntoSection })}
            role="switch"
            aria-checked={exportSettings.groupIntoSection}
          >
            <span className="toggle-thumb" />
          </button>
        </div>

        <div className="export-divider" />

        {/* Create New Page */}
        <div className="export-setting-row">
          <div className="export-setting-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="11" x2="12" y2="17"/>
              <line x1="9" y1="14" x2="15" y2="14"/>
            </svg>
            <span className="body-s">Create New Page</span>
          </div>
          <button
            className={`toggle ${exportSettings.createNewPage ? 'on' : 'off'}`}
            onClick={() => setExportSettings({ createNewPage: !exportSettings.createNewPage })}
            role="switch"
            aria-checked={exportSettings.createNewPage}
          >
            <span className="toggle-thumb" />
          </button>
        </div>
      </div>

      {/* Success message */}
      {insertResult && (
        <div className="export-success">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span className="body-s">
            {insertResult.count} slide{insertResult.count !== 1 ? 's' : ''} inserted!
          </span>
          <button
            className="btn-link export-dismiss"
            onClick={() => { setInsertResult(null); setShowExportPanel(false); }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* CTA */}
      <button
        data-appearance="primary"
        className="export-cta"
        onClick={handleInsert}
        disabled={slides.length === 0 || isInserting}
      >
        {isInserting ? (
          <>
            <div className="spinner spinner-sm" />
            Inserting…
          </>
        ) : (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Insert into Canvas
          </>
        )}
      </button>
    </div>
  );
}
