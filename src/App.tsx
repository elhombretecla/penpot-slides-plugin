import { useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useSlideStore } from './store';
import type { PluginMessage, Slide } from './types';
import { SLIDE_SIZE_PRESETS } from './types';
import HomeScreen from './screens/HomeScreen';
import LibraryPicker from './screens/LibraryPicker';
import SlideManager from './screens/SlideManager';
import NewSlideModal from './components/NewSlideModal';
import ImportProgressOverlay from './components/ImportProgressOverlay';

export default function App() {
  const screen = useSlideStore((s) => s.screen);
  const theme = useSlideStore((s) => s.theme);
  const setTheme = useSlideStore((s) => s.setTheme);
  const setLibraries = useSlideStore((s) => s.setLibraries);
  const setLibrariesLoading = useSlideStore((s) => s.setLibrariesLoading);
  const setComponents = useSlideStore((s) => s.setComponents);
  const setComponentsLoading = useSlideStore((s) => s.setComponentsLoading);
  const setIsInserting = useSlideStore((s) => s.setIsInserting);
  const setInsertResult = useSlideStore((s) => s.setInsertResult);
  const setThumbnail = useSlideStore((s) => s.setThumbnail);
  const setPendingThumbnails = useSlideStore((s) => s.setPendingThumbnails);
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

  // Listen to messages from plugin.ts
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as PluginMessage & { source?: string };

      if (data.source === 'penpot' && 'theme' in data) {
        setTheme((data as { theme: 'light' | 'dark' }).theme);
        return;
      }

      if (!data || !data.type) return;

      const store = useSlideStore.getState();

      switch (data.type) {
        case 'libraries':
          setLibraries(data.libraries);
          setLibrariesLoading(false);
          break;

        case 'components':
          setComponents(data.libraryId, data.components);
          setComponentsLoading(false);
          setPendingThumbnails(data.components.map((c) => c.id));
          break;

        case 'thumbnail':
          setThumbnail(data.componentId, data.thumbnail);
          break;

        case 'thumbnails-complete':
          setPendingThumbnails([]);
          break;

        case 'import-start':
          // Job is already initialized by the UI before sending the request;
          // ignore stale starts from previous requests.
          break;

        case 'import-progress':
          store.reportImportProgress(
            data.requestId,
            data.index,
            data.total,
            data.componentName
          );
          break;

        case 'import-item':
          store.reportImportItem(data.requestId, {
            componentId: data.componentId,
            libraryId: data.libraryId,
            componentName: data.componentName,
            nodes: data.nodes,
            background: data.background,
            backgroundFills: data.backgroundFills,
            width: data.width,
            height: data.height,
            importedAt: Date.now(),
          });
          break;

        case 'import-item-error':
          store.reportImportError(data.requestId, {
            componentId: data.componentId,
            componentName: data.componentName,
            message: data.message,
          });
          break;

        case 'import-complete': {
          store.finishImportJob(data.requestId);
          finalizeImport(data.requestId);
          break;
        }

        case 'insert-complete':
          setIsInserting(false);
          setInsertResult({ count: data.count });
          break;

        case 'error':
          setIsInserting(false);
          setLibrariesLoading(false);
          setComponentsLoading(false);
          console.error('[SlideBuilder]', data.message);
          break;

        case 'theme':
          setTheme(data.theme as 'light' | 'dark');
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [
    setTheme,
    setLibraries,
    setLibrariesLoading,
    setComponents,
    setComponentsLoading,
    setIsInserting,
    setInsertResult,
    setThumbnail,
    setPendingThumbnails,
  ]);

  return (
    <div className="app-root">
      {screen === 'home' && <HomeScreen />}
      {screen === 'library-picker' && <LibraryPicker />}
      {screen === 'slide-manager' && <SlideManager />}
      {showNewSlideModal && <NewSlideModal />}
      <ImportProgressOverlay />
    </div>
  );
}

// Once the plugin reports the batch import is done, build a slide for every
// item that landed in the cache, transition to the editor, and clear the job
// after a short delay so the user sees the completion state.
function finalizeImport(requestId: string) {
  const state = useSlideStore.getState();
  const job = state.importJob;
  if (!job || job.requestId !== requestId) return;

  const thumbnails = state.thumbnailsMap;
  const defaultSize = SLIDE_SIZE_PRESETS['16:9'];

  const newSlides: Slide[] = [];
  for (const item of job.items) {
    const cached = state.getCachedComponent(item.libraryId, item.componentId);
    if (!cached) continue;

    newSlides.push({
      id: uuidv4(),
      name: cached.componentName || item.componentName,
      source: 'library-component',
      width: cached.width || item.width || defaultSize.width,
      height: cached.height || item.height || defaultSize.height,
      background: cached.background,
      backgroundFills: cached.backgroundFills,
      nodes: cached.nodes,
      libraryId: cached.libraryId,
      componentId: cached.componentId,
      componentName: cached.componentName,
      thumbnailUrl: thumbnails[cached.componentId],
      nodesLoading: false,
    });
  }

  if (newSlides.length > 0) {
    state.addSlides(newSlides);
    state.setScreen('slide-manager');
  }

  state.clearComponentSelection();

  // Keep the overlay visible briefly so the user sees the completion state,
  // then dismiss it.
  window.setTimeout(() => {
    const current = useSlideStore.getState().importJob;
    if (current && current.requestId === requestId) {
      useSlideStore.getState().clearImportJob();
    }
  }, 600);
}
