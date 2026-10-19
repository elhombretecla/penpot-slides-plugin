/**
 * API bridge between React UI and plugin.ts via postMessage.
 * All functions send typed messages to plugin.ts and return void;
 * responses are handled in App.tsx via a global message listener.
 */
import type { UIMessage, Slide, ExportSettings, ImportItemRequest, DeckSummary, TemplateRef } from './types';

function send(message: UIMessage) {
  parent.postMessage(message, '*');
}

export const penpotApi = {
  getLibraries: () => send({ type: 'get-libraries' }),
  getAvailableLibraries: () => send({ type: 'get-available-libraries' }),
  connectLibrary: (libraryId: string) => send({ type: 'connect-library', libraryId }),
  getCatalog: (requestId: string, libraryId: string) => send({ type: 'get-catalog', requestId, libraryId }),
  getThumbnails: (requestId: string, libraryId: string, known: Record<string, string>, force: boolean) =>
    send({ type: 'get-thumbnails', requestId, libraryId, known, force }),
  importComponents: (requestId: string, items: ImportItemRequest[]) =>
    send({ type: 'import-components', requestId, items }),
  getAsset: (requestId: string, libraryId: string, componentId: string) =>
    send({ type: 'get-asset', requestId, libraryId, componentId }),
  insertIntoCanvas: (deckId: string, deckName: string, slides: Slide[], settings: ExportSettings) =>
    send({ type: 'insert-into-canvas', deckId, deckName, slides, settings }),
  listDecks: () => send({ type: 'list-decks' }),
  loadDeck: (deckId: string) => send({ type: 'load-deck', deckId }),
  saveDeck: (requestId: string, deck: string, summary: DeckSummary) =>
    send({ type: 'save-deck', requestId, deck, summary }),
  deleteDeck: (deckId: string) => send({ type: 'delete-deck', deckId }),
  renderSlide: (requestId: string, slide: Slide) => send({ type: 'render-slide', requestId, slide }),
  findDeck: (deckId: string) => send({ type: 'find-deck', deckId }),
  getFonts: () => send({ type: 'get-fonts' }),
  getTokens: () => send({ type: 'get-tokens' }),
  createTypography: (requestId: string, name: string, style: Partial<Slide['nodes'][number]>) =>
    send({ type: 'create-typography', requestId, name, style }),
  createColor: (requestId: string, name: string, color: string, opacity: number) =>
    send({ type: 'create-color', requestId, name, color, opacity }),
  pullDeck: (requestId: string, deckId: string, templates: Record<string, TemplateRef | null>) =>
    send({ type: 'pull-deck', requestId, deckId, templates }),
  resize: (width: number, height: number) => send({ type: 'resize', width, height }),
};
