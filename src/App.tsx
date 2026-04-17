import { useEffect } from 'react';
import { useSlideStore } from './store';
import type { PluginMessage } from './types';
import HomeScreen from './screens/HomeScreen';
import LibraryPicker from './screens/LibraryPicker';
import SlideManager from './screens/SlideManager';
import NewSlideModal from './components/NewSlideModal';

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
      // Ignore messages not from penpot
      const data = event.data as PluginMessage & { source?: string };

      // Theme change from penpot itself
      if (data.source === 'penpot' && 'theme' in data) {
        setTheme((data as { theme: 'light' | 'dark' }).theme);
        return;
      }

      if (!data || !data.type) return;

      switch (data.type) {
        case 'libraries':
          setLibraries(data.libraries);
          setLibrariesLoading(false);
          break;
        case 'components':
          setComponents(data.libraryId, data.components);
          setComponentsLoading(false);
          break;
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
  }, [setTheme, setLibraries, setLibrariesLoading, setComponents, setComponentsLoading, setIsInserting, setInsertResult]);

  return (
    <div className="app-root">
      {screen === 'home' && <HomeScreen />}
      {screen === 'library-picker' && <LibraryPicker />}
      {screen === 'slide-manager' && <SlideManager />}
      {showNewSlideModal && <NewSlideModal />}
    </div>
  );
}
