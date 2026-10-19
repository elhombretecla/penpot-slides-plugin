import type { UIMessage } from './types';
import { readDeckIndex, handleLoadDeck, handleSaveDeck, handleDeleteDeck } from './plugin/persistence';
import { handleGetLibraries, handleGetAvailableLibraries, handleConnectLibrary, handleGetCatalog, handleGetFonts, handleGetTokens, handleCreateTypography, handleCreateColor } from './plugin/libraries';
import { handleGetThumbnails, handleGetAsset, handleRenderSlide } from './plugin/render';
import { exclusive, sweepScratch } from './plugin/jobs';
import { handleImportComponents } from './plugin/import';
import { handleInsertIntoCanvas, findDeckPlacement, handlePullDeck } from './plugin/insert';
import { send } from './plugin/util';
import { openWindow, sendWindowState, setMaximized } from './plugin/window';

openWindow();

// ─── Message Handler ──────────────────────────────────────────────────────────

penpot.ui.onMessage<UIMessage>((message) => {
  switch (message.type) {
    case 'get-libraries':
      handleGetLibraries();
      break;
    case 'get-available-libraries':
      void handleGetAvailableLibraries();
      break;
    case 'connect-library':
      void handleConnectLibrary(message.libraryId);
      break;
    case 'get-catalog':
      handleGetCatalog(message.requestId, message.libraryId);
      break;
    case 'get-thumbnails':
      void handleGetThumbnails(message.requestId, message.libraryId, message.known, message.force);
      break;
    case 'import-components':
      void exclusive(() => handleImportComponents(message.requestId, message.items));
      break;
    case 'get-asset':
      void handleGetAsset(message.requestId, message.libraryId, message.componentId);
      break;
    case 'insert-into-canvas':
      void exclusive(() =>
        handleInsertIntoCanvas(message.deckId, message.deckName, message.slides, message.settings)
      );
      break;
    case 'list-decks':
      send({ type: 'decks', decks: readDeckIndex() });
      break;
    case 'load-deck':
      handleLoadDeck(message.deckId);
      break;
    case 'save-deck':
      handleSaveDeck(message.requestId, message.deck, message.summary);
      break;
    case 'delete-deck':
      handleDeleteDeck(message.deckId);
      break;
    case 'render-slide':
      void handleRenderSlide(message.requestId, message.slide);
      break;
    case 'get-fonts':
      handleGetFonts();
      break;
    case 'get-tokens':
      handleGetTokens();
      break;
    case 'create-typography':
      handleCreateTypography(message.requestId, message.name, message.style);
      break;
    case 'create-color':
      handleCreateColor(message.requestId, message.name, message.color, message.opacity);
      break;
    case 'find-deck':
      send({ type: 'deck-placement', deckId: message.deckId, placement: findDeckPlacement(message.deckId) });
      break;
    case 'pull-deck':
      void exclusive(() => handlePullDeck(message.requestId, message.deckId, message.templates));
      break;
    case 'resize':
      penpot.ui.resize(message.width, message.height);
      break;
    case 'set-maximized':
      setMaximized(message.maximized);
      break;
    case 'get-window-state':
      sendWindowState();
      break;
  }
});

// ─── Theme Change ─────────────────────────────────────────────────────────────

penpot.on('themechange', (theme) => {
  send({ type: 'theme', theme });
});


// Leftovers of a job interrupted by closing the plugin.
sweepScratch();
