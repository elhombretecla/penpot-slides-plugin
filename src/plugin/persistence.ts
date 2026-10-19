import type { DeckSummary } from '../types';
import { stringifyErr, send, sendError } from './util';

// ─── Deck persistence ─────────────────────────────────────────────────────────
// Decks live inside the Penpot file as shared plugin data, so they travel with
// the file (and its collaborators) instead of dying with the plugin window.
// The UI serialises the deck; the plugin only stores strings.

export const DATA_NS = 'slidebuilder';
const DECK_INDEX_KEY = 'decks';
const deckKey = (id: string) => `deck:${id}`;

export function readDeckIndex(): DeckSummary[] {
  try {
    const raw = penpot.currentFile?.getSharedPluginData(DATA_NS, DECK_INDEX_KEY);
    const list = raw ? (JSON.parse(raw) as DeckSummary[]) : [];
    return Array.isArray(list) ? list.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    // A corrupt index must not lock the user out: start a fresh list.
    return [];
  }
}

function writeDeckIndex(list: DeckSummary[]) {
  penpot.currentFile?.setSharedPluginData(DATA_NS, DECK_INDEX_KEY, JSON.stringify(list));
}

export function handleLoadDeck(deckId: string) {
  let deck: string | null = null;
  try {
    deck = penpot.currentFile?.getSharedPluginData(DATA_NS, deckKey(deckId)) || null;
  } catch (err) {
    sendError('Could not read the presentation: ' + stringifyErr(err));
  }
  send({ type: 'deck-loaded', deckId, deck });
}

export function handleSaveDeck(requestId: string, deck: string, summary: DeckSummary) {
  try {
    const file = penpot.currentFile;
    if (!file) throw new Error('No file is open.');
    file.setSharedPluginData(DATA_NS, deckKey(summary.id), deck);
    const list = readDeckIndex().filter((d) => d.id !== summary.id);
    writeDeckIndex([summary, ...list]);
    send({ type: 'deck-saved', requestId, deckId: summary.id, ok: true });
  } catch (err) {
    send({ type: 'deck-saved', requestId, deckId: summary.id, ok: false, message: stringifyErr(err) });
  }
}

export function handleDeleteDeck(deckId: string) {
  try {
    // Plugin data keys cannot be removed, only emptied (spike Q9).
    penpot.currentFile?.setSharedPluginData(DATA_NS, deckKey(deckId), '');
    writeDeckIndex(readDeckIndex().filter((d) => d.id !== deckId));
  } catch (err) {
    sendError('Could not delete the presentation: ' + stringifyErr(err));
  }
  send({ type: 'decks', decks: readDeckIndex() });
}
