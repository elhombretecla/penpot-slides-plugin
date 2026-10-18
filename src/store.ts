import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { penpotApi } from './api';
import type {
  Slide,
  SlideNode,
  LibraryInfo,
  ComponentInfo,
  ExportSettings,
  ImportJob,
  ImportItemRequest,
  ImportJobError,
  ImportedComponentPayload,
} from './types';

export type Screen = 'home' | 'library-picker' | 'slide-manager';

export interface Notice {
  id: string;
  kind: 'error' | 'warning' | 'success';
  message: string;
  details?: string[];
}
export type SidePanel = 'properties' | 'layers';

// ─── Tree Helpers ─────────────────────────────────────────────────────────────
// All slide node operations are recursive so that grouped / nested imports
// behave identically to flat top-level nodes.

function mapNodes(
  nodes: SlideNode[],
  nodeId: string,
  fn: (n: SlideNode) => SlideNode | null
): SlideNode[] {
  const out: SlideNode[] = [];
  for (const n of nodes) {
    if (n.id === nodeId) {
      const updated = fn(n);
      if (updated) out.push(updated);
      continue;
    }
    if (n.children && n.children.length > 0) {
      out.push({ ...n, children: mapNodes(n.children, nodeId, fn) });
    } else {
      out.push(n);
    }
  }
  return out;
}

// Node arrays are ordered bottom→top, exactly like Penpot `children`: a
// higher index paints in front. 'forward' moves one step towards the front.
export type StackDirection = 'forward' | 'backward';

function reorderSiblings(
  nodes: SlideNode[],
  nodeId: string,
  direction: StackDirection
): { nodes: SlideNode[]; moved: boolean } {
  const idx = nodes.findIndex((n) => n.id === nodeId);
  if (idx !== -1) {
    const target = direction === 'forward' ? idx + 1 : idx - 1;
    if (target < 0 || target >= nodes.length) return { nodes, moved: true };
    const next = [...nodes];
    [next[idx], next[target]] = [next[target], next[idx]];
    return { nodes: next, moved: true };
  }
  // Recurse into groups
  let moved = false;
  const out = nodes.map((n) => {
    if (moved || !n.children || n.children.length === 0) return n;
    const res = reorderSiblings(n.children, nodeId, direction);
    if (res.moved) {
      moved = true;
      return { ...n, children: res.nodes };
    }
    return n;
  });
  return { nodes: out, moved };
}

function removeNode(nodes: SlideNode[], nodeId: string): SlideNode[] {
  const out: SlideNode[] = [];
  for (const n of nodes) {
    if (n.id === nodeId) continue;
    if (n.children && n.children.length > 0) {
      out.push({ ...n, children: removeNode(n.children, nodeId) });
    } else {
      out.push(n);
    }
  }
  return out;
}

export function findNode(nodes: SlideNode[], nodeId: string): SlideNode | null {
  for (const n of nodes) {
    if (n.id === nodeId) return n;
    if (n.children && n.children.length > 0) {
      const res = findNode(n.children, nodeId);
      if (res) return res;
    }
  }
  return null;
}

function cacheKey(libraryId: string, componentId: string): string {
  return `${libraryId}:${componentId}`;
}

function regenerateNodeIds(nodes: SlideNode[]): SlideNode[] {
  return nodes.map((n) => ({
    ...n,
    id: uuidv4(),
    children: n.children ? regenerateNodeIds(n.children) : undefined,
  }));
}

// Coalescing state lives outside the store: it never needs to re-render UI.
const HISTORY_COALESCE_MS = 1000;
let lastCoalesced: { key: string; at: number } | null = null;

// ─── Store Definition ─────────────────────────────────────────────────────────

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
  receiveComponents: (requestId: string, libraryId: string, components: ComponentInfo[]) => void;
  componentsLoading: boolean;
  setComponentsLoading: (v: boolean) => void;

  // Thumbnails are cached by component id for the whole session — switching
  // libraries never throws them away. Only the latest components request may
  // update the pending set (older, cancelled requests are ignored).
  thumbnailsMap: Record<string, string>;
  thumbnailsPending: Set<string>;
  componentsRequestId: string | null;
  requestComponents: (libraryId: string) => void;
  setThumbnail: (requestId: string, componentId: string, thumbnail: string) => void;
  finishThumbnails: (requestId: string) => void;

  // ── Notices (toasts) ───────────────────────────────────────────────────────
  notices: Notice[];
  pushNotice: (kind: Notice['kind'], message: string, details?: string[]) => void;
  dismissNotice: (id: string) => void;

  selectedComponentIds: Set<string>;
  toggleComponentSelection: (componentId: string, libraryId: string) => void;
  clearComponentSelection: () => void;
  selectedComponentLibraryMap: Record<string, string>;

  // ── Import Pipeline ────────────────────────────────────────────────────────
  importJob: ImportJob | null;
  importedComponentsCache: Record<string, ImportedComponentPayload>;
  startImportJob: (items: ImportItemRequest[]) => string;
  reportImportProgress: (
    requestId: string,
    index: number,
    total: number,
    componentName: string
  ) => void;
  reportImportItem: (
    requestId: string,
    payload: ImportedComponentPayload,
    warnings: string[]
  ) => void;
  reportImportError: (requestId: string, error: ImportJobError) => void;
  finishImportJob: (requestId: string) => void;
  clearImportJob: () => void;
  getCachedComponent: (
    libraryId: string,
    componentId: string
  ) => ImportedComponentPayload | null;

  // ── Slides ─────────────────────────────────────────────────────────────────
  slides: Slide[];
  activeSlideId: string | null;
  selectedNodeIds: string[];
  sidePanel: SidePanel;
  setSidePanel: (panel: SidePanel) => void;

  // ── History (undo / redo) ──────────────────────────────────────────────────
  // Each entry is a snapshot of the `slides` array. Slide updates are always
  // immutable (spread / map), so shallow snapshots are safe — the referenced
  // slide objects cannot be mutated after capture.
  history: { past: Slide[][]; future: Slide[][] };
  commitHistory: () => void;
  // Like commitHistory, but consecutive calls with the same key within
  // HISTORY_COALESCE_MS collapse into one undo step (typing in a field,
  // dragging a number input…).
  commitHistoryCoalesced: (key: string) => void;
  undo: () => void;
  redo: () => void;

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
  reorderNode: (slideId: string, nodeId: string, direction: StackDirection) => void;
  setSlideNodes: (slideId: string, nodes: SlideNode[], background?: string) => void;
  selectNode: (nodeId: string | null) => void;
  addSelectedNode: (nodeId: string) => void;
  setSelectedNodes: (ids: string[]) => void;

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
  receiveComponents: (requestId, libraryId, components) =>
    set((state) => ({
      componentsMap: { ...state.componentsMap, [libraryId]: components },
      componentsLoading: false,
      thumbnailsPending:
        requestId === state.componentsRequestId
          ? new Set(components.filter((c) => !state.thumbnailsMap[c.id]).map((c) => c.id))
          : state.thumbnailsPending,
    })),
  componentsLoading: false,
  setComponentsLoading: (componentsLoading) => set({ componentsLoading }),

  thumbnailsMap: {},
  thumbnailsPending: new Set(),
  componentsRequestId: null,
  requestComponents: (libraryId) => {
    const requestId = uuidv4();
    const known = Object.keys(get().thumbnailsMap);
    set({ componentsRequestId: requestId });
    penpotApi.getComponents(requestId, libraryId, known);
  },
  setThumbnail: (requestId, componentId, thumbnail) =>
    set((state) => {
      // Late thumbnails from a superseded request are still valid images —
      // cache them, but only the current request drives the pending set.
      const next = new Set(state.thumbnailsPending);
      if (requestId === state.componentsRequestId) next.delete(componentId);
      return {
        thumbnailsMap: { ...state.thumbnailsMap, [componentId]: thumbnail },
        thumbnailsPending: next,
      };
    }),
  finishThumbnails: (requestId) =>
    set((state) =>
      requestId === state.componentsRequestId ? { thumbnailsPending: new Set<string>() } : state
    ),

  notices: [],
  pushNotice: (kind, message, details) =>
    set((state) => ({
      // Keep the stack short; the newest notice is last.
      notices: [...state.notices.slice(-3), { id: uuidv4(), kind, message, details }],
    })),
  dismissNotice: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),

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

  // ── Import Pipeline ────────────────────────────────────────────────────────
  importJob: null,
  importedComponentsCache: {},
  startImportJob: (items) => {
    const requestId = uuidv4();
    set({
      importJob: {
        requestId,
        items,
        total: items.length,
        done: 0,
        failed: 0,
        errors: [],
        warnings: [],
        status: 'running',
        currentComponentName: items[0]?.componentName,
      },
    });
    return requestId;
  },
  reportImportProgress: (requestId, _index, _total, componentName) =>
    set((state) => {
      if (!state.importJob || state.importJob.requestId !== requestId) return state;
      return {
        importJob: {
          ...state.importJob,
          currentComponentName: componentName,
        },
      };
    }),
  reportImportItem: (requestId, payload, warnings) =>
    set((state) => {
      if (!state.importJob || state.importJob.requestId !== requestId) return state;
      const key = cacheKey(payload.libraryId, payload.componentId);
      return {
        importedComponentsCache: {
          ...state.importedComponentsCache,
          [key]: payload,
        },
        importJob: {
          ...state.importJob,
          done: state.importJob.done + 1,
          warnings: [...state.importJob.warnings, ...warnings],
        },
      };
    }),
  reportImportError: (requestId, error) =>
    set((state) => {
      if (!state.importJob || state.importJob.requestId !== requestId) return state;
      return {
        importJob: {
          ...state.importJob,
          failed: state.importJob.failed + 1,
          errors: [...state.importJob.errors, error],
        },
      };
    }),
  finishImportJob: (requestId) =>
    set((state) => {
      if (!state.importJob || state.importJob.requestId !== requestId) return state;
      return {
        importJob: {
          ...state.importJob,
          status: 'complete',
        },
      };
    }),
  clearImportJob: () => set({ importJob: null }),
  getCachedComponent: (libraryId, componentId) => {
    const key = cacheKey(libraryId, componentId);
    return get().importedComponentsCache[key] ?? null;
  },

  // ── Slides ─────────────────────────────────────────────────────────────────
  slides: [],
  activeSlideId: null,
  selectedNodeIds: [],
  sidePanel: 'properties',
  setSidePanel: (sidePanel) => set({ sidePanel }),

  history: { past: [], future: [] },
  commitHistory: () =>
    set((state) => ({
      history: {
        // Cap at 50 to bound memory — oldest entries are dropped first.
        past: [...state.history.past.slice(-49), state.slides],
        future: [],
      },
    })),
  commitHistoryCoalesced: (key) => {
    const now = Date.now();
    const prev = lastCoalesced;
    lastCoalesced = { key, at: now };
    if (prev && prev.key === key && now - prev.at < HISTORY_COALESCE_MS) return;
    get().commitHistory();
  },
  undo: () =>
    set((state) => {
      lastCoalesced = null;
      const { past, future } = state.history;
      if (past.length === 0) return {};
      const prev = past[past.length - 1];
      // `activeSlideId` may point at a slide that didn't exist yet at the
      // snapshot time (or that was deleted since) — fall back to the first
      // slide when the current id is not present.
      const activeStillExists = prev.some((s) => s.id === state.activeSlideId);
      return {
        slides: prev,
        activeSlideId: activeStillExists ? state.activeSlideId : prev[0]?.id ?? null,
        // Selection refers to node ids that may no longer exist in `prev`;
        // clearing avoids dangling references that would confuse the canvas.
        selectedNodeIds: [],
        history: {
          past: past.slice(0, -1),
          future: [state.slides, ...future],
        },
      };
    }),
  redo: () =>
    set((state) => {
      lastCoalesced = null;
      const { past, future } = state.history;
      if (future.length === 0) return {};
      const next = future[0];
      const activeStillExists = next.some((s) => s.id === state.activeSlideId);
      return {
        slides: next,
        activeSlideId: activeStillExists ? state.activeSlideId : next[0]?.id ?? null,
        selectedNodeIds: [],
        history: {
          past: [...past, state.slides],
          future: future.slice(1),
        },
      };
    }),

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
      nodes: regenerateNodeIds(src.nodes),
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
  // setSlideNodes keeps the original source (library-component vs custom) so
  // imported slides remain traceable to their library origin after editing.
  setSlideNodes: (slideId, nodes, background) =>
    set((state) => ({
      slides: state.slides.map((s) =>
        s.id === slideId
          ? {
              ...s,
              nodes,
              nodesLoading: false,
              ...(background ? { background } : {}),
            }
          : s
      ),
    })),
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
              nodes: mapNodes(s.nodes, nodeId, (n) => ({ ...n, ...updates })),
            }
          : s
      ),
    })),
  deleteNode: (slideId, nodeId) =>
    set((state) => ({
      slides: state.slides.map((s) =>
        s.id === slideId ? { ...s, nodes: removeNode(s.nodes, nodeId) } : s
      ),
      selectedNodeIds: state.selectedNodeIds.filter((id) => id !== nodeId),
    })),
  reorderNode: (slideId, nodeId, direction) =>
    set((state) => ({
      slides: state.slides.map((s) => {
        if (s.id !== slideId) return s;
        const res = reorderSiblings(s.nodes, nodeId, direction);
        return { ...s, nodes: res.nodes };
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
  setSelectedNodes: (ids) => set({ selectedNodeIds: ids }),

  // ── Export ─────────────────────────────────────────────────────────────────
  exportSettings: {
    spacing: 100,
    wrapInDeck: true,
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
