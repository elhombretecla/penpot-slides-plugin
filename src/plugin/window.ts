import { send } from './util';

// ─── Plugin window ───────────────────────────────────────────────────────────
// The plugin cannot read the browser window size, but Penpot clamps
// ui.resize() to the tab (innerWidth / innerHeight − 40 px) and slides the
// modal back into view: asking for a huge size fills the tab. The modal is
// always opened at a normal size first — opened at full size, Penpot would
// place it partly off-screen. The choice is remembered in the plugin's own
// storage (allow:localstorage), read before the window opens.

const DEFAULT_SIZE = { width: 1040, height: 720 };
const HUGE = 100_000;
const PREF_KEY = 'maximized';

let maximized = false;
let restoreSize: { width: number; height: number } | null = null;

function readPref(): boolean {
  try {
    return penpot.localStorage.getItem(PREF_KEY) === '1';
  } catch {
    // No storage permission (an older install): open at the normal size.
    return false;
  }
}

function writePref(on: boolean) {
  try {
    penpot.localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    // Not remembered; the toggle still works for this session.
  }
}

export function openWindow() {
  // Comfortable for a slide editor: slide list, canvas, speaker notes and the
  // design panel side by side.
  penpot.ui.open('Slide Builder', `?theme=${penpot.theme}`, DEFAULT_SIZE);
  if (readPref()) setMaximized(true);
}

export function sendWindowState() {
  send({ type: 'window-state', maximized });
}

export function setMaximized(on: boolean) {
  if (on && !maximized) {
    restoreSize = penpot.ui.size ?? DEFAULT_SIZE;
    penpot.ui.resize(HUGE, HUGE);
  } else if (on) {
    // Again: fits a browser window resized since.
    penpot.ui.resize(HUGE, HUGE);
  } else if (maximized) {
    const size = restoreSize ?? DEFAULT_SIZE;
    penpot.ui.resize(size.width, size.height);
  }
  maximized = on;
  writePref(on);
  sendWindowState();
}
