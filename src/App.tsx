import { useEffect } from 'react';
import { useSlideStore } from './store';
import type { PluginMessage, Slide } from './types';
import { slideFromImported } from './utils';
import HomeScreen from './screens/HomeScreen';
import LibraryPicker from './screens/LibraryPicker';
import SlideManager from './screens/SlideManager';
import NewSlideModal from './components/NewSlideModal';
import ImportProgressOverlay from './components/ImportProgressOverlay';
import Notices from './components/Notices';

export default function App() {
  const screen = useSlideStore((s) => s.screen);
  const theme = useSlideStore((s) => s.theme);
  const setTheme = useSlideStore((s) => s.setTheme);
  const setLibraries = useSlideStore((s) => s.setLibraries);
  const setLibrariesLoading = useSlideStore((s) => s.setLibrariesLoading);
  const setComponentsLoading = useSlideStore((s) => s.setComponentsLoading);
  const setIsInserting = useSlideStore((s) => s.setIsInserting);
  const setInsertResult = useSlideStore((s) => s.setInsertResult);
  const setThumbnail = useSlideStore((s) => s.setThumbnail);
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
          store.receiveComponents(data.requestId, data.libraryId, data.components);
          break;

        case 'thumbnail':
          setThumbnail(data.requestId, data.componentId, data.thumbnail);
          break;

        case 'thumbnails-complete':
          store.finishThumbnails(data.requestId);
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
          }, data.warnings ?? []);
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
          if (data.warnings.length > 0) {
            store.pushNotice(
              'warning',
              `${data.count} slide${data.count !== 1 ? 's' : ''} inserted with ${data.warnings.length} issue${data.warnings.length !== 1 ? 's' : ''}.`,
              data.warnings
            );
          }
          break;

        case 'error':
          setIsInserting(false);
          setLibrariesLoading(false);
          setComponentsLoading(false);
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
  }, [
    setTheme,
    setLibraries,
    setLibrariesLoading,
    setComponentsLoading,
    setIsInserting,
    setInsertResult,
    setThumbnail,
  ]);

  return (
    <div className="app-root">
      {screen === 'home' && <HomeScreen />}
      {screen === 'library-picker' && <LibraryPicker />}
      {screen === 'slide-manager' && <SlideManager />}
      {showNewSlideModal && <NewSlideModal />}
      <ImportProgressOverlay />
      <Notices />
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

  const newSlides: Slide[] = [];
  for (const item of job.items) {
    const cached = state.getCachedComponent(item.libraryId, item.componentId);
    if (!cached) continue;
    newSlides.push(
      slideFromImported(cached, {
        name: item.componentName,
        width: item.width,
        height: item.height,
        thumbnailUrl: state.thumbnailsMap[cached.componentId],
      })
    );
  }

  if (newSlides.length > 0) {
    state.addSlides(newSlides);
    state.setScreen('slide-manager');
  }

  state.clearComponentSelection();

  // The progress overlay closes after a moment, so failures must outlive it.
  if (job.errors.length > 0) {
    state.pushNotice(
      'error',
      `${job.errors.length} template${job.errors.length !== 1 ? 's' : ''} could not be imported.`,
      job.errors.map((e) => `${e.componentName}: ${e.message}`)
    );
  }

  if (job.warnings.length > 0) {
    state.pushNotice(
      'warning',
      `Imported with ${job.warnings.length} issue${job.warnings.length !== 1 ? 's' : ''}: some elements were simplified or skipped.`,
      [...new Set(job.warnings)]
    );
  }

  // Keep the overlay visible briefly so the user sees the completion state,
  // then dismiss it.
  window.setTimeout(() => {
    const current = useSlideStore.getState().importJob;
    if (current && current.requestId === requestId) {
      useSlideStore.getState().clearImportJob();
    }
  }, 600);
}
