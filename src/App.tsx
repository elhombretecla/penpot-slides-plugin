import { useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useSlideStore } from './store';
import type { PluginMessage } from './types';
import { parseDeck } from './deck';
import { onDeckSaved, startAutosave } from './autosave';
import { receiveSlideRender, startRenderer } from './render/renderer';
import { isSvgMarkup, prepareSvg } from './render/svg';
import { resolveCreated } from './libraryAssets';
import { finishTemplateJob } from './templateActions';
import { penpotApi } from './api';
import HomeScreen from './screens/HomeScreen';
import LibraryPicker from './screens/LibraryPicker';
import SlideManager from './screens/SlideManager';
import NewSlideModal from './components/NewSlideModal';
import ImportProgressOverlay from './components/ImportProgressOverlay';
import Notices from './components/Notices';
import ErrorBoundary from './components/ErrorBoundary';

// Gallery cards are small: embedded pictures are downscaled to this size.
const THUMBNAIL_IMAGE_MAX = 480;

export default function App() {
  const screen = useSlideStore((s) => s.screen);
  const theme = useSlideStore((s) => s.theme);
  const setTheme = useSlideStore((s) => s.setTheme);
  const showNewSlideModal = useSlideStore((s) => s.showNewSlideModal);

  // Read theme from URL param on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('theme');
    if (t === 'light' || t === 'dark') setTheme(t);
  }, [setTheme]);

  // Set theme on body dataset for penpot-styles CSS vars
  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => startAutosave(), []);
  useEffect(() => startRenderer(), []);

  // Listen to messages from plugin.ts
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as PluginMessage & { source?: string };
      if (!data) return;

      if (data.source === 'penpot' && 'theme' in data) {
        setTheme((data as { theme: 'light' | 'dark' }).theme);
        return;
      }
      if (!data.type) return;

      const store = useSlideStore.getState();

      switch (data.type) {
        case 'libraries':
          store.setLibraries(data.libraries, data.fileName);
          store.setLocalLibraryId(data.localLibraryId);
          break;

        case 'fonts':
          store.setFonts(data.fonts);
          break;

        case 'tokens':
          store.setColorTokens(data.tokens);
          break;

        case 'typography-created':
          resolveCreated(data.requestId, data.typography, data.message);
          if (data.typography) store.addLibraryTypography(data.typography);
          break;

        case 'color-created':
          resolveCreated(data.requestId, data.color, data.message);
          if (data.color) store.addLibraryColor(data.color);
          break;

        case 'available-libraries':
          store.setAvailableLibraries(data.libraries);
          break;

        case 'library-connected':
          store.setAvailableLibraries(
            (store.availableLibraries ?? []).filter((l) => l.id !== data.libraryId)
          );
          store.pushNotice('success', 'Library connected to this file.');
          break;

        case 'catalog':
          store.receiveCatalog(data.requestId, data.catalog);
          break;

        case 'thumbnail':
          if (isSvgMarkup(data.thumbnail)) {
            const { requestId, componentId, signature } = data;
            void prepareSvg(data.thumbnail, THUMBNAIL_IMAGE_MAX).then((svg) =>
              useSlideStore.getState().setThumbnail(requestId, componentId, svg, signature)
            );
          } else {
            store.setThumbnail(data.requestId, data.componentId, data.thumbnail, data.signature);
          }
          break;

        case 'deck-placement':
          if (store.deck?.id === data.deckId) store.setDeckPlacement(data.placement);
          break;

        case 'deck-pulled': {
          if (store.pullRequestId !== data.requestId) break;
          store.setPullRequestId(null);
          if (data.message) {
            store.pushNotice('error', `Could not read the slides from Penpot: ${data.message}`);
            break;
          }
          const n = store.applyPulledSlides(data.slides);
          const msg = n > 0
            ? `${n} slide${n !== 1 ? 's' : ''} updated with the changes made in Penpot.`
            : 'No slides of this presentation were found in Penpot.';
          if (data.warnings.length > 0) store.pushNotice('warning', msg, data.warnings);
          else store.pushNotice(n > 0 ? 'success' : 'warning', msg);
          break;
        }

        case 'slide-render':
          void receiveSlideRender(data.requestId, data.svg, data.shapes, data.message);
          break;

        case 'thumbnails-complete':
          store.finishThumbnails(data.requestId);
          break;

        case 'import-start':
          // The job is initialised by the UI before the request is sent.
          break;

        case 'import-progress':
          store.reportImportProgress(data.requestId, data.componentName);
          break;

        case 'import-item':
          store.reportImportItem(data.requestId, { ...data.payload, importedAt: Date.now() }, data.warnings ?? []);
          break;

        case 'import-item-error':
          store.reportImportError(data.requestId, {
            componentId: data.componentId,
            componentName: data.componentName,
            message: data.message,
          });
          break;

        case 'import-complete':
          store.finishImportJob(data.requestId);
          finishTemplateJob(data.requestId);
          break;

        case 'asset': {
          const target = store.resolveAsset(data.requestId);
          if (!target) break;
          if (!data.node) {
            store.pushNotice('error', 'The element could not be inserted.', data.message ? [data.message] : undefined);
            break;
          }
          const slide = store.slides.find((s) => s.id === target.slideId);
          if (!slide) break;
          // Fit big elements inside the slide and drop them in the centre.
          const fit = Math.min(1, (slide.width * 0.5) / data.node.width, (slide.height * 0.5) / data.node.height);
          const width = data.node.width * fit;
          const height = data.node.height * fit;
          const node = {
            ...data.node,
            id: uuidv4(),
            width,
            height,
            x: (slide.width - width) / 2,
            y: (slide.height - height) / 2,
          };
          store.commitHistory();
          store.addNode(slide.id, node);
          store.selectNode(node.id);
          store.setSidePanel('properties');
          break;
        }

        case 'insert-complete':
          store.setIsInserting(false);
          store.setInsertResult({
            count: data.count,
            updated: data.updated,
            added: data.added,
            removed: data.removed,
            pageName: data.pageName,
          });
          if (store.deck) penpotApi.findDeck(store.deck.id);
          if (data.warnings.length > 0) {
            store.pushNotice(
              'warning',
              `${data.count} slide${data.count !== 1 ? 's' : ''} inserted with ${data.warnings.length} issue${data.warnings.length !== 1 ? 's' : ''}.`,
              data.warnings
            );
          }
          break;

        case 'decks':
          store.setDecks(data.decks);
          break;

        case 'deck-loaded':
          if (!data.deck) {
            store.pushNotice('error', 'This presentation is no longer in the file.');
            penpotApi.listDecks();
            break;
          }
          try {
            store.openDeck(parseDeck(data.deck));
          } catch (err) {
            store.pushNotice('error', 'The presentation could not be opened.', [
              err instanceof Error ? err.message : String(err),
            ]);
          }
          break;

        case 'deck-saved':
          onDeckSaved(data.requestId, data.ok, data.message);
          break;

        case 'error':
          store.setIsInserting(false);
          store.setLibrariesLoading(false);
          console.error('[SlideBuilder]', data.message);
          store.pushNotice('error', data.message);
          break;

        case 'theme':
          setTheme(data.theme as 'light' | 'dark');
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [setTheme]);

  return (
    <div className="app-root">
      <ErrorBoundary>
        {screen === 'home' && <HomeScreen />}
        {screen === 'library-picker' && <LibraryPicker />}
        {screen === 'slide-manager' && <SlideManager />}
        {showNewSlideModal && <NewSlideModal />}
      </ErrorBoundary>
      <ImportProgressOverlay />
      <Notices />
    </div>
  );
}
