import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
  Slide,
  SlideNode,
  LibraryInfo,
  ComponentInfo,
  ExportSettings,
} from './types';

export type Screen = 'home' | 'library-picker' | 'slide-manager';
export type SidePanel = 'properties' | 'layers';

interface SlideStore {
  // ── Navigation ─────────────────────────────────────────────────────────────
  screen: Screen;
  setScreen: (screen: Screen) => void;

  // ── Theme ──────────────────────────────────────────────────────────────────
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;

  // ── Libraries ──────────────────────────────────────────────────────────────
  libraries: LibraryInfo[];
  setLibraries: (libs: LibraryInfo[]) => void;
  librariesLoading: boolean;
  setLibrariesLoading: (v: boolean) => void;

  componentsMap: Record<string, ComponentInfo[]>;
  setComponents: (libraryId: string, components: ComponentInfo[]) => void;
  componentsLoading: boolean;
  setComponentsLoading: (v: boolean) => void;

  thumbnailsMap: Record<string, string>; // componentId → base64 data URL
  thumbnailsPending: Set<string>;        // componentIds still being exported
  setThumbnail: (componentId: string, thumbnail: string) => void;
  setPendingThumbnails: (ids: string[]) => void;
  clearThumbnails: () => void;

  selectedComponentIds: Set<string>;
  toggleComponentSelection: (componentId: string, libraryId: string) => void;
  clearComponentSelection: () => void;
  selectedComponentLibraryMap: Record<string, string>;

  // ── Slides ─────────────────────────────────────────────────────────────────
  slides: Slide[];
  activeSlideId: string | null;
  selectedNodeIds: string[];
  sidePanel: SidePanel;
  setSidePanel: (panel: SidePanel) => void;

  setSlides: (slides: Slide[]) => void;
  addSlide: (slide: Slide) => void;
  addSlides: (slides: Slide[]) => void;
  updateSlide: (id: string, updates: Partial<Omit<Slide, 'nodes'>>) => void;
  deleteSlide: (id: string) => void;
  duplicateSlide: (id: string) => void;
  reorderSlides: (fromIndex: number, toIndex: number) => void;
  setActiveSlide: (id: string | null) => void;

  // ── Nodes ──────────────────────────────────────────────────────────────────
  addNode: (slideId: string, node: SlideNode) => void;
  updateNode: (slideId: string, nodeId: string, updates: Partial<SlideNode>) => void;
  deleteNode: (slideId: string, nodeId: string) => void;
  reorderNode: (slideId: string, nodeId: string, direction: 'up' | 'down') => void;
  selectNode: (nodeId: string | null) => void;
  addSelectedNode: (nodeId: string) => void;

  // ── Export ─────────────────────────────────────────────────────────────────
  exportSettings: ExportSettings;
  setExportSettings: (settings: Partial<ExportSettings>) => void;
  isInserting: boolean;
  setIsInserting: (v: boolean) => void;
  insertResult: { count: number } | null;
  setInsertResult: (r: { count: number } | null) => void;

  // ── Modals ─────────────────────────────────────────────────────────────────
  showNewSlideModal: boolean;
  setShowNewSlideModal: (v: boolean) => void;
  showExportPanel: boolean;
  setShowExportPanel: (v: boolean) => void;

  // ── Search (Library Picker) ────────────────────────────────────────────────
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  activeLibraryId: string | null;
  setActiveLibraryId: (id: string | null) => void;
}

export const useSlideStore = create<SlideStore>((set, get) => ({
  // ── Navigation ─────────────────────────────────────────────────────────────
  screen: 'home',
  setScreen: (screen) => set({ screen }),

  // ── Theme ──────────────────────────────────────────────────────────────────
  theme: 'dark',
  setTheme: (theme) => set({ theme }),

  // ── Libraries ──────────────────────────────────────────────────────────────
  libraries: [],
  setLibraries: (libraries) => set({ libraries }),
  librariesLoading: false,
  setLibrariesLoading: (librariesLoading) => set({ librariesLoading }),

  componentsMap: {},
  setComponents: (libraryId, components) =>
    set((state) => ({
      componentsMap: { ...state.componentsMap, [libraryId]: components },
    })),
  componentsLoading: false,
  setComponentsLoading: (componentsLoading) => set({ componentsLoading }),

  thumbnailsMap: {},
  thumbnailsPending: new Set(),
  setThumbnail: (componentId, thumbnail) =>
    set((state) => {
      const next = new Set(state.thumbnailsPending);
      next.delete(componentId);
      return {
        thumbnailsMap: { ...state.thumbnailsMap, [componentId]: thumbnail },
        thumbnailsPending: next,
      };
    }),
  setPendingThumbnails: (ids) => set({ thumbnailsPending: new Set(ids) }),
  clearThumbnails: () => set({ thumbnailsMap: {}, thumbnailsPending: new Set() }),

  selectedComponentIds: new Set(),
  selectedComponentLibraryMap: {},
  toggleComponentSelection: (componentId, libraryId) =>
    set((state) => {
      const next = new Set(state.selectedComponentIds);
      const nextMap = { ...state.selectedComponentLibraryMap };
      if (next.has(componentId)) {
        next.delete(componentId);
        delete nextMap[componentId];
      } else {
        next.add(componentId);
        nextMap[componentId] = libraryId;
      }
      return { selectedComponentIds: next, selectedComponentLibraryMap: nextMap };
    }),
  clearComponentSelection: () =>
    set({ selectedComponentIds: new Set(), selectedComponentLibraryMap: {} }),

  // ── Slides ─────────────────────────────────────────────────────────────────
  slides: [],
  activeSlideId: null,
  selectedNodeIds: [],
  sidePanel: 'properties',
  setSidePanel: (sidePanel) => set({ sidePanel }),

  setSlides: (slides) => set({ slides }),
  addSlide: (slide) =>
    set((state) => ({
      slides: [...state.slides, slide],
      activeSlideId: slide.id,
    })),
  addSlides: (slides) =>
    set((state) => ({
      slides: [...state.slides, ...slides],
      activeSlideId: slides[slides.length - 1]?.id ?? state.activeSlideId,
    })),
  updateSlide: (id, updates) =>
    set((state) => ({
      slides: state.slides.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    })),
  deleteSlide: (id) =>
    set((state) => {
      const remaining = state.slides.filter((s) => s.id !== id);
      const wasActive = state.activeSlideId === id;
      const newActive = wasActive ? (remaining[0]?.id ?? null) : state.activeSlideId;
      return { slides: remaining, activeSlideId: newActive, selectedNodeIds: [] };
    }),
  duplicateSlide: (id) => {
    const { slides } = get();
    const src = slides.find((s) => s.id === id);
    if (!src) return;
    const copy: Slide = {
      ...src,
      id: uuidv4(),
      name: `${src.name} (copy)`,
      nodes: src.nodes.map((n) => ({ ...n, id: uuidv4() })),
    };
    set((state) => {
      const idx = state.slides.findIndex((s) => s.id === id);
      const next = [...state.slides];
      next.splice(idx + 1, 0, copy);
      return { slides: next, activeSlideId: copy.id };
    });
  },
  reorderSlides: (fromIndex, toIndex) =>
    set((state) => {
      const next = [...state.slides];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return { slides: next };
    }),
  setActiveSlide: (activeSlideId) =>
    set({ activeSlideId, selectedNodeIds: [] }),

  // ── Nodes ──────────────────────────────────────────────────────────────────
  addNode: (slideId, node) =>
    set((state) => ({
      slides: state.slides.map((s) =>
        s.id === slideId ? { ...s, nodes: [...s.nodes, node] } : s
      ),
    })),
  updateNode: (slideId, nodeId, updates) =>
    set((state) => ({
      slides: state.slides.map((s) =>
        s.id === slideId
          ? {
              ...s,
              nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, ...updates } : n)),
            }
          : s
      ),
    })),
  deleteNode: (slideId, nodeId) =>
    set((state) => ({
      slides: state.slides.map((s) =>
        s.id === slideId
          ? { ...s, nodes: s.nodes.filter((n) => n.id !== nodeId) }
          : s
      ),
      selectedNodeIds: state.selectedNodeIds.filter((id) => id !== nodeId),
    })),
  reorderNode: (slideId, nodeId, direction) =>
    set((state) => ({
      slides: state.slides.map((s) => {
        if (s.id !== slideId) return s;
        const nodes = [...s.nodes];
        const idx = nodes.findIndex((n) => n.id === nodeId);
        if (idx === -1) return s;
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= nodes.length) return s;
        [nodes[idx], nodes[targetIdx]] = [nodes[targetIdx], nodes[idx]];
        return { ...s, nodes };
      }),
    })),
  selectNode: (nodeId) =>
    set({ selectedNodeIds: nodeId ? [nodeId] : [] }),
  addSelectedNode: (nodeId) =>
    set((state) => ({
      selectedNodeIds: state.selectedNodeIds.includes(nodeId)
        ? state.selectedNodeIds.filter((id) => id !== nodeId)
        : [...state.selectedNodeIds, nodeId],
    })),

  // ── Export ─────────────────────────────────────────────────────────────────
  exportSettings: {
    spacing: 100,
    groupIntoSection: true,
    createNewPage: false,
    slidePrefix: 'Slide',
  },
  setExportSettings: (settings) =>
    set((state) => ({
      exportSettings: { ...state.exportSettings, ...settings },
    })),
  isInserting: false,
  setIsInserting: (isInserting) => set({ isInserting }),
  insertResult: null,
  setInsertResult: (insertResult) => set({ insertResult }),

  // ── Modals ─────────────────────────────────────────────────────────────────
  showNewSlideModal: false,
  setShowNewSlideModal: (showNewSlideModal) => set({ showNewSlideModal }),
  showExportPanel: false,
  setShowExportPanel: (showExportPanel) => set({ showExportPanel }),

  // ── Search ─────────────────────────────────────────────────────────────────
  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  activeLibraryId: null,
  setActiveLibraryId: (activeLibraryId) => set({ activeLibraryId }),
}));
