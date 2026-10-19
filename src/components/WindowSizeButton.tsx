import { useSlideStore } from '../store';
import { penpotApi } from '../api';

// Fill the browser tab with the plugin (Penpot keeps a 40 px margin), or go
// back to the previous size. The plugin remembers the choice for the next
// opening.
export default function WindowSizeButton() {
  const maximized = useSlideStore((s) => s.windowMaximized);
  const label = maximized ? 'Restore window size' : 'Fill the browser tab';
  return (
    <button
      className="btn-icon window-size-btn"
      onClick={() => penpotApi.setMaximized(!maximized)}
      title={label}
      aria-pressed={maximized}
    >
      {maximized ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
      )}
    </button>
  );
}
