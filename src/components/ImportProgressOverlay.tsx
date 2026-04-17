import { useSlideStore } from '../store';

export default function ImportProgressOverlay() {
  const importJob = useSlideStore((s) => s.importJob);

  if (!importJob) return null;

  const { total, done, failed, currentComponentName, status, errors } = importJob;
  const processed = done + failed;
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const isComplete = status === 'complete';

  return (
    <div className="import-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div className="import-overlay-panel">
        <div className="import-overlay-icon">
          {isComplete ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <div className="spinner" />
          )}
        </div>

        <div className="import-overlay-title">
          {isComplete ? 'Import complete' : 'Importing components…'}
        </div>

        <div className="import-overlay-subtitle">
          {isComplete
            ? `${done} of ${total} component${total !== 1 ? 's' : ''} imported${
                failed > 0 ? `, ${failed} failed` : ''
              }`
            : currentComponentName
              ? `Reading “${currentComponentName}” (${Math.min(processed + 1, total)} of ${total})`
              : `Preparing ${total} component${total !== 1 ? 's' : ''}…`}
        </div>

        <div className="import-overlay-progress" aria-hidden="true">
          <div
            className="import-overlay-progress-bar"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="import-overlay-counters">
          <span>
            {processed} / {total}
          </span>
          {failed > 0 && (
            <span className="import-overlay-failed">{failed} failed</span>
          )}
        </div>

        {errors.length > 0 && (
          <ul className="import-overlay-errors">
            {errors.slice(0, 3).map((err, idx) => (
              <li key={idx}>
                <strong>{err.componentName}:</strong> {err.message}
              </li>
            ))}
            {errors.length > 3 && (
              <li className="import-overlay-errors-more">
                …and {errors.length - 3} more
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
