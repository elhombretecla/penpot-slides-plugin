import { useEffect, useState } from 'react';
import { useSlideStore } from '../store';
import type { Notice } from '../store';

// Success notices fade on their own; errors and warnings stay until the user
// dismisses them so nothing fails silently.
const SUCCESS_TIMEOUT_MS = 4000;

export default function Notices() {
  const notices = useSlideStore((s) => s.notices);
  if (notices.length === 0) return null;
  return (
    <div className="notices" role="status" aria-live="polite">
      {notices.map((n) => (
        <NoticeItem key={n.id} notice={n} />
      ))}
    </div>
  );
}

function NoticeItem({ notice }: { notice: Notice }) {
  const dismissNotice = useSlideStore((s) => s.dismissNotice);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (notice.kind !== 'success') return;
    const t = window.setTimeout(() => dismissNotice(notice.id), SUCCESS_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [notice.id, notice.kind, dismissNotice]);

  const details = notice.details ?? [];

  return (
    <div className={`notice notice--${notice.kind}`}>
      <div className="notice-row">
        <span className="notice-message body-s">{notice.message}</span>
        <button className="notice-close" onClick={() => dismissNotice(notice.id)} title="Dismiss">
          ×
        </button>
      </div>
      {details.length > 0 && (
        <>
          <button className="btn-link notice-toggle" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Hide details' : `Show details (${details.length})`}
          </button>
          {expanded && (
            <ul className="notice-details body-xs">
              {details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
