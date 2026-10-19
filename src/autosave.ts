import { v4 as uuidv4 } from 'uuid';
import { penpotApi } from './api';
import { serializeDeck, summarizeDeck } from './deck';
import { useSlideStore } from './store';

// Autosave: every change to the open deck is written to the Penpot file a
// moment after the user stops editing. Saves are serialised — one in flight
// at a time — and a change made during a save schedules another one.

const SAVE_DELAY_MS = 1200;

let timer: number | null = null;
let inFlight: string | null = null;
let again = false;

export function startAutosave(): () => void {
  const unsubscribe = useSlideStore.subscribe((state, prev) => {
    if (!state.deck || !prev.deck || state.deck.id !== prev.deck.id) return;
    const changed =
      state.slides !== prev.slides || state.deck !== prev.deck || state.exportSettings !== prev.exportSettings;
    if (!changed) return;
    if (state.saveStatus !== 'dirty') state.setSaveStatus('dirty');
    schedule();
  });
  const onHide = () => flushSave();
  window.addEventListener('pagehide', onHide);
  return () => {
    unsubscribe();
    window.removeEventListener('pagehide', onHide);
  };
}

function schedule() {
  if (timer != null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    save();
  }, SAVE_DELAY_MS);
}

// Save now if there are pending changes (leaving the editor, closing).
export function flushSave() {
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (useSlideStore.getState().saveStatus === 'dirty') save();
}

function save() {
  if (inFlight) {
    again = true;
    return;
  }
  const state = useSlideStore.getState();
  const snapshot = state.getDeckSnapshot();
  if (!snapshot) return;
  const deck = { ...snapshot, updatedAt: Date.now() };
  const requestId = uuidv4();
  inFlight = requestId;
  state.setSaveStatus('saving');
  try {
    penpotApi.saveDeck(requestId, serializeDeck(deck), summarizeDeck(deck));
  } catch (err) {
    inFlight = null;
    state.setSaveStatus('error', err instanceof Error ? err.message : String(err));
  }
}

// Called by App when the plugin acknowledges a save.
export function onDeckSaved(requestId: string, ok: boolean, message?: string) {
  if (requestId !== inFlight) return;
  inFlight = null;
  const state = useSlideStore.getState();
  if (!ok) {
    state.setSaveStatus('error', message ?? 'Unknown error');
    state.pushNotice('error', 'The presentation could not be saved in the file.', message ? [message] : undefined);
    return;
  }
  if (again) {
    again = false;
    save();
    return;
  }
  // Changes that arrived while saving keep the status 'dirty' and have their
  // own timer; otherwise everything is on disk.
  if (state.saveStatus === 'saving') state.setSaveStatus('saved');
  penpotApi.listDecks();
}
