import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { penpotApi } from './api';
import type {
  AvailableLibrary,
  Deck,
  DeckSummary,
  Slide,
  SlideNode,
  LibraryCatalog,
  LibraryInfo,
  ExportSettings,
  ImportJob,
  ImportItemRequest,
  ImportJobError,
  ImportPurpose,
  ImportedComponentPayload,
  DeckPlacement,
  PulledSlide,
  FontInfo,
  ColorTokenInfo,
  LibraryColorInfo,
  LibraryTypographyInfo,
} from './types';
import { cloneNodeWithNewIds, createDeck, inferRoles } from './deck';
import { readThumbnails, writeThumbnail } from './thumbCache';

export type Screen = 'home' | 'library-picker' | 'slide-manager';

export interface Notice {
  id: string;
  kind: 'error' | 'warning' | 'success';
  message: string;
  details?: string[];
}
export type SidePanel = 'properties' | 'layers' | 'insert';
// Main area of the editor: one slide on the canvas, or every slide in a grid.
export type EditorView = 'canvas' | 'grid';

export interface InsertResult {
  count: number;
  updated?: number;
  added?: number;
  removed?: number;
  pageName?: string;
}

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

// Deck metadata; the slides live in the top-level `slides` array so every
// editor component keeps working on them directly.
export type DeckMeta = Omit<Deck, 'slides'>;

// What the template gallery is opened for.
export type PickerIntent =
  | { kind: 'new-deck' }
  | { kind: 'add-slides'; afterSlideId: string | null }
  | { kind: 'change-layout'; slideId: string };

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  spacing: 100,
  wrapInDeck: false,
  createNewPage: true,
  slidePrefix: 'Slide',
  createFlow: true,
  mode: 'update',
};

let fontsRequested = false;

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
export type StackDirection = 'forward' | 'backward' | 'front' | 'back';

function reorderSiblings(
  nodes: SlideNode[],
  nodeId: string,
  direction: StackDirection
): { nodes: SlideNode[]; moved: boolean } {
  const idx = nodes.findIndex((n) => n.id === nodeId);
  if (idx !== -1) {
    const target =
      direction === 'forward' ? idx + 1
      : direction === 'backward' ? idx - 1
      : direction === 'front' ? nodes.length - 1
      : 0;
    if (target < 0 || target >= nodes.length || target === idx) return { nodes, moved: true };
    const next = [...nodes];
    const [node] = next.splice(idx, 1);
    next.splice(target, 0, node);
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

// Coalescing state lives outside the store: it never needs to re-render UI.
const HISTORY_COALESCE_MS = 1000;
let lastCoalesced: { key: string; at: number } | null = null;


// Slot content the user touched — drives "change layout" (only edited
// content travels to the new template).
function markEdited(node: SlideNode, updates: Partial<SlideNode>): Partial<SlideNode> {
  if (!node.slotId || node.edited) return updates;
  const touchesContent =
    ('text' in updates && updates.text !== node.text) || ('imageUrl' in updates && updates.imageReplaced);
  return touchesContent ? { ...updates, edited: true } : updates;
}

// ─── Store Definition ─────────────────────────────────────────────────────────

interface SlideStore {
  // ── Navigation ─────────────────────────────────────────────────────────────
  screen: Screen;
  setScreen: (screen: Screen) => void;

  // ── Theme ──────────────────────────────────────────────────────────────────
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;

  // ── File & decks ───────────────────────────────────────────────────────────
  fileName: string;
  decks: DeckSummary[];
  decksLoaded: boolean;
  setDecks: (decks: DeckSummary[]) => void;
  // The open deck (null on the home screen).
  deck: DeckMeta | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  setSaveStatus: (status: SaveStatus, error?: string | null) => void;
  newDeck: (name: string, library?: { id: string; name: string }) => void;
  openDeck: (deck: Deck) => void;
  closeDeck: () => void;
  updateDeck: (patch: Partial<Pick<DeckMeta, 'name' | 'libraryId' | 'libraryName'>>) => void;
  getDeckSnapshot: () => Deck | null;

  // ── Libraries & catalog ────────────────────────────────────────────────────
  libraries: LibraryInfo[];
  setLibraries: (libs: LibraryInfo[], fileName: string) => void;
  librariesLoading: boolean;
  setLibrariesLoading: (v: boolean) => void;
  availableLibraries: AvailableLibrary[] | null;
  setAvailableLibraries: (libs: AvailableLibrary[] | null) => void;

  catalogs: Record<string, LibraryCatalog>;
  catalogRequestId: string | null;
  catalogLoading: boolean;
  requestCatalog: (libraryId: string) => void;
  receiveCatalog: (requestId: string, catalog: LibraryCatalog) => void;
  // Catalog for its colors and text styles only (no thumbnails pass).
  requestStyles: (libraryId: string) => void;

  // The file's own library (where new text styles and colors are saved).
  localLibraryId: string | null;
  setLocalLibraryId: (id: string) => void;
  addLibraryTypography: (t: LibraryTypographyInfo) => void;
  addLibraryColor: (c: LibraryColorInfo) => void;

  // Penpot's font catalog, loaded on first use.
  fonts: FontInfo[] | null;
  requestFonts: () => void;
  setFonts: (fonts: FontInfo[]) => void;

  // Color tokens of the file's active sets.
  colorTokens: ColorTokenInfo[];
  setColorTokens: (tokens: ColorTokenInfo[]) => void;

  recentColors: string[];
  pushRecentColor: (hex: string) => void;

  // Thumbnails are cached by component id across sessions (IndexedDB) and
  // validated by the plugin's signature. Only the latest request drives the
  // pending set; late thumbnails from older requests are still cached.
  thumbnailsMap: Record<string, string>;
  thumbnailSignatures: Record<string, string>;
  thumbnailsPending: Set<string>;
  thumbnailsRequestId: string | null;
  requestThumbnails: (libraryId: string, force?: boolean) => Promise<void>;
  setThumbnail: (requestId: string, componentId: string, thumbnail: string, signature: string) => void;
  finishThumbnails: (requestId: string) => void;

  // ── Notices (toasts) ───────────────────────────────────────────────────────
  notices: Notice[];
  pushNotice: (kind: Notice['kind'], message: string, details?: string[]) => void;
  dismissNotice: (id: string) => void;

  // ── Template gallery ───────────────────────────────────────────────────────
  pickerIntent: PickerIntent;
  openPicker: (intent: PickerIntent, libraryId?: string | null) => void;
  selectedComponentIds: string[];
  toggleComponentSelection: (componentId: string) => void;
  clearComponentSelection: () => void;

  // ── Import Pipeline ────────────────────────────────────────────────────────
  importJob: ImportJob | null;
  importedComponentsCache: Record<string, ImportedComponentPayload>;
  startImportJob: (items: ImportItemRequest[], purpose: ImportPurpose) => string;
  reportImportProgress: (requestId: string, componentName: string) => void;
  reportImportItem: (requestId: string, payload: ImportedComponentPayload, warnings: string[]) => void;
  reportImportError: (requestId: string, error: ImportJobError) => void;
  finishImportJob: (requestId: string) => void;
  clearImportJob: () => void;
  getCachedComponent: (libraryId: string, componentId: string) => ImportedComponentPayload | null;

  // Library elements being fetched for insertion: requestId → target slide.
  pendingAssets: Record<string, { slideId: string }>;
  requestAsset: (slideId: string, libraryId: string, componentId: string) => void;
  resolveAsset: (requestId: string) => { slideId: string } | null;

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

  addSlides: (slides: Slide[], afterSlideId?: string | null) => void;
  replaceSlide: (slide: Slide) => void;
  updateSlide: (id: string, updates: Partial<Omit<Slide, 'nodes'>>) => void;
  deleteSlide: (id: string) => void;
  duplicateSlide: (id: string) => void;
  reorderSlides: (fromIndex: number, toIndex: number) => void;
  setActiveSlide: (id: string | null) => void;
  editorView: EditorView;
  setEditorView: (view: EditorView) => void;
  // Index of the slide the presentation is showing; null when not presenting.
  presenting: number | null;
  setPresenting: (index: number | null) => void;

  // ── Nodes ──────────────────────────────────────────────────────────────────
  addNode: (slideId: string, node: SlideNode) => void;
  updateNode: (slideId: string, nodeId: string, updates: Partial<SlideNode>) => void;
  // Shift several nodes at once (drag, nudge, align) in one store update.
  moveNodes: (slideId: string, moves: Map<string, { dx: number; dy: number }>) => void;
  deleteNode: (slideId: string, nodeId: string) => void;
  reorderNode: (slideId: string, nodeId: string, direction: StackDirection) => void;
  selectNode: (nodeId: string | null) => void;
  setSelectedNodes: (ids: string[]) => void;

  // ── Export ─────────────────────────────────────────────────────────────────
  exportSettings: ExportSettings;
  setExportSettings: (settings: Partial<ExportSettings>) => void;
  isInserting: boolean;
  setIsInserting: (v: boolean) => void;
  insertResult: InsertResult | null;
  setInsertResult: (r: InsertResult | null) => void;

  // Where the open deck was inserted before (undefined = not asked yet).
  deckPlacement: DeckPlacement | null | undefined;
  setDeckPlacement: (p: DeckPlacement | null | undefined) => void;
  pullRequestId: string | null;
  setPullRequestId: (id: string | null) => void;
  // Replace slides with their boards' content as read from Penpot.
  applyPulledSlides: (pulled: PulledSlide[]) => number;

  // ── Modals ─────────────────────────────────────────────────────────────────
  showNewSlideModal: boolean;
  setShowNewSlideModal: (v: boolean) => void;
  showExportPanel: boolean;
  setShowExportPanel: (v: boolean) => void;

  // ── Search (gallery) ───────────────────────────────────────────────────────
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  activeLibraryId: string | null;
  setActiveLibraryId: (id: string | null) => void;
}

const EMPTY_HISTORY = { past: [] as Slide[][], future: [] as Slide[][] };

export const useSlideStore = create<SlideStore>((set, get) => ({
  // ── Navigation ─────────────────────────────────────────────────────────────
  screen: 'home',
  setScreen: (screen) => set({ screen }),

  // ── Theme ──────────────────────────────────────────────────────────────────
  theme: 'dark',
  setTheme: (theme) => set({ theme }),

  // ── File & decks ───────────────────────────────────────────────────────────
  fileName: '',
  decks: [],
  decksLoaded: false,
  setDecks: (decks) => set({ decks, decksLoaded: true }),
  deck: null,
  saveStatus: 'saved',
  saveError: null,
  setSaveStatus: (saveStatus, error = null) => set({ saveStatus, saveError: error }),
  newDeck: (name, library) => {
    const { slides: _slides, ...meta } = createDeck(name, library);
    void _slides;
    set({
      deck: meta,
      slides: [],
      activeSlideId: null,
      selectedNodeIds: [],
      history: EMPTY_HISTORY,
      exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
      activeLibraryId: library?.id ?? get().activeLibraryId,
      // A brand-new deck is saved on its first change, not before: an empty
      // deck the user abandons should not litter the file.
      saveStatus: 'saved',
      saveError: null,
      deckPlacement: null,
      insertResult: null,
    });
  },
  openDeck: (deck) => {
    const { slides, ...meta } = deck;
    lastCoalesced = null;
    set({
      deck: meta,
      slides,
      activeSlideId: slides[0]?.id ?? null,
      selectedNodeIds: [],
      history: EMPTY_HISTORY,
      exportSettings: { ...DEFAULT_EXPORT_SETTINGS, ...deck.exportSettings },
      activeLibraryId: deck.libraryId ?? get().activeLibraryId,
      saveStatus: 'saved',
      saveError: null,
      screen: 'slide-manager',
      deckPlacement: undefined,
      insertResult: null,
    });
  },
  closeDeck: () =>
    set({
      deck: null,
      slides: [],
      activeSlideId: null,
      selectedNodeIds: [],
      editorView: 'canvas',
      presenting: null,
      history: EMPTY_HISTORY,
      screen: 'home',
    }),
  updateDeck: (patch) =>
    set((state) => (state.deck ? { deck: { ...state.deck, ...patch } } : state)),
  getDeckSnapshot: () => {
    const { deck, slides, exportSettings } = get();
    if (!deck) return null;
    return { ...deck, slides, exportSettings };
  },

  // ── Libraries & catalog ────────────────────────────────────────────────────
  libraries: [],
  setLibraries: (libraries, fileName) => set({ libraries, fileName, librariesLoading: false }),
  librariesLoading: false,
  setLibrariesLoading: (librariesLoading) => set({ librariesLoading }),
  availableLibraries: null,
  setAvailableLibraries: (availableLibraries) => set({ availableLibraries }),

  catalogs: {},
  catalogRequestId: null,
  catalogLoading: false,
  requestCatalog: (libraryId) => {
    const requestId = uuidv4();
    set({ catalogRequestId: requestId, catalogLoading: !get().catalogs[libraryId] });
    penpotApi.getCatalog(requestId, libraryId);
  },
  requestStyles: (libraryId) => penpotApi.getCatalog(uuidv4(), libraryId),

  localLibraryId: null,
  setLocalLibraryId: (localLibraryId) => set({ localLibraryId }),
  addLibraryTypography: (t) =>
    set((state) => {
      const catalog = state.catalogs[t.libraryId] ?? { libraryId: t.libraryId, components: [], colors: [], typographies: [] };
      return { catalogs: { ...state.catalogs, [t.libraryId]: { ...catalog, typographies: [...catalog.typographies, t] } } };
    }),
  addLibraryColor: (c) =>
    set((state) => {
      const catalog = state.catalogs[c.libraryId] ?? { libraryId: c.libraryId, components: [], colors: [], typographies: [] };
      return { catalogs: { ...state.catalogs, [c.libraryId]: { ...catalog, colors: [...catalog.colors, c] } } };
    }),

  fonts: null,
  requestFonts: () => {
    if (fontsRequested) return;
    fontsRequested = true;
    penpotApi.getFonts();
  },
  setFonts: (fonts) => set({ fonts }),

  colorTokens: [],
  setColorTokens: (colorTokens) => set({ colorTokens }),

  recentColors: [],
  pushRecentColor: (hex) =>
    set((state) => {
      const color = hex.toLowerCase();
      return { recentColors: [color, ...state.recentColors.filter((c) => c !== color)].slice(0, 8) };
    }),

  receiveCatalog: (requestId, catalog) => {
    set((state) => ({
      catalogs: { ...state.catalogs, [catalog.libraryId]: catalog },
      catalogLoading: requestId === state.catalogRequestId ? false : state.catalogLoading,
    }));
    if (requestId === get().catalogRequestId) void get().requestThumbnails(catalog.libraryId);
  },

  thumbnailsMap: {},
  thumbnailSignatures: {},
  thumbnailsPending: new Set(),
  thumbnailsRequestId: null,
  requestThumbnails: async (libraryId, force = false) => {
    const requestId = uuidv4();
    const catalog = get().catalogs[libraryId];
    const ids = catalog?.components.map((c) => c.id) ?? [];
    set({ thumbnailsRequestId: requestId });

    // Show cached thumbnails right away; the plugin then re-renders only the
    // components whose signature changed.
    const missing = ids.filter((id) => !get().thumbnailsMap[id]);
    const cached = await readThumbnails(missing);
    if (get().thumbnailsRequestId !== requestId) return;
    const thumbs = { ...get().thumbnailsMap };
    const sigs = { ...get().thumbnailSignatures };
    for (const [id, v] of Object.entries(cached)) {
      thumbs[id] = v.thumbnail;
      sigs[id] = v.signature;
    }
    const known: Record<string, string> = {};
    for (const id of ids) if (thumbs[id] && sigs[id]) known[id] = sigs[id];
    set({
      thumbnailsMap: thumbs,
      thumbnailSignatures: sigs,
      thumbnailsPending: new Set(force ? ids : ids.filter((id) => !thumbs[id])),
    });
    penpotApi.getThumbnails(requestId, libraryId, known, force);
  },
  setThumbnail: (requestId, componentId, thumbnail, signature) => {
    void writeThumbnail(componentId, { thumbnail, signature });
    set((state) => {
      const next = new Set(state.thumbnailsPending);
      if (requestId === state.thumbnailsRequestId) next.delete(componentId);
      return {
        thumbnailsMap: { ...state.thumbnailsMap, [componentId]: thumbnail },
        thumbnailSignatures: { ...state.thumbnailSignatures, [componentId]: signature },
        thumbnailsPending: next,
      };
    });
  },
  finishThumbnails: (requestId) =>
    set((state) =>
      requestId === state.thumbnailsRequestId ? { thumbnailsPending: new Set<string>() } : state
    ),

  notices: [],
  pushNotice: (kind, message, details) =>
    set((state) => ({
      // Keep the stack short; the newest notice is last.
      notices: [...state.notices.slice(-3), { id: uuidv4(), kind, message, details }],
    })),
  dismissNotice: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),

  // ── Template gallery ───────────────────────────────────────────────────────
  pickerIntent: { kind: 'new-deck' },
  openPicker: (pickerIntent, libraryId) =>
    set((state) => ({
      pickerIntent,
      screen: 'library-picker',
      selectedComponentIds: [],
      searchQuery: '',
      activeLibraryId: libraryId ?? state.deck?.libraryId ?? state.activeLibraryId,
    })),
  selectedComponentIds: [],
  toggleComponentSelection: (componentId) =>
    set((state) => {
      // Changing a layout picks exactly one template.
      if (state.pickerIntent.kind === 'change-layout') return { selectedComponentIds: [componentId] };
      const has = state.selectedComponentIds.includes(componentId);
      return {
        selectedComponentIds: has
          ? state.selectedComponentIds.filter((id) => id !== componentId)
          : [...state.selectedComponentIds, componentId],
      };
    }),
  clearComponentSelection: () => set({ selectedComponentIds: [] }),

  // ── Import Pipeline ────────────────────────────────────────────────────────
  importJob: null,
  importedComponentsCache: {},
  startImportJob: (items, purpose) => {
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
        purpose,
      },
    });
    return requestId;
  },
  reportImportProgress: (requestId, componentName) =>
    set((state) => {
      if (!state.importJob || state.importJob.requestId !== requestId) return state;
      return { importJob: { ...state.importJob, currentComponentName: componentName } };
    }),
  reportImportItem: (requestId, payload, warnings) =>
    set((state) => {
      if (!state.importJob || state.importJob.requestId !== requestId) return state;
      const key = cacheKey(payload.libraryId, payload.componentId);
      // A template opened from its own file reports the local library id;
      // cache under the requested id too so lookups by either id hit.
      const requested = state.importJob.items.find((i) => i.componentId === payload.componentId);
      const extra = requested && requested.libraryId !== payload.libraryId
        ? { [cacheKey(requested.libraryId, payload.componentId)]: payload }
        : {};
      return {
        importedComponentsCache: { ...state.importedComponentsCache, [key]: payload, ...extra },
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
      return { importJob: { ...state.importJob, status: 'complete' } };
    }),
  clearImportJob: () => set({ importJob: null }),
  getCachedComponent: (libraryId, componentId) =>
    get().importedComponentsCache[cacheKey(libraryId, componentId)] ?? null,

  pendingAssets: {},
  requestAsset: (slideId, libraryId, componentId) => {
    const requestId = uuidv4();
    set((state) => ({ pendingAssets: { ...state.pendingAssets, [requestId]: { slideId } } }));
    penpotApi.getAsset(requestId, libraryId, componentId);
  },
  resolveAsset: (requestId) => {
    const target = get().pendingAssets[requestId] ?? null;
    if (target) {
      set((state) => {
        const next = { ...state.pendingAssets };
        delete next[requestId];
        return { pendingAssets: next };
      });
    }
    return target;
  },

  // ── Slides ─────────────────────────────────────────────────────────────────
  slides: [],
  activeSlideId: null,
  selectedNodeIds: [],
  sidePanel: 'properties',
  setSidePanel: (sidePanel) => set({ sidePanel }),

  history: EMPTY_HISTORY,
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

  addSlides: (slides, afterSlideId) =>
    set((state) => {
      if (slides.length === 0) return state;
      const idx = afterSlideId ? state.slides.findIndex((s) => s.id === afterSlideId) : -1;
      const next = [...state.slides];
      next.splice(idx === -1 ? next.length : idx + 1, 0, ...slides);
      return { slides: next, activeSlideId: slides[0].id, selectedNodeIds: [] };
    }),
  replaceSlide: (slide) =>
    set((state) => ({
      slides: state.slides.map((s) => (s.id === slide.id ? slide : s)),
      selectedNodeIds: [],
    })),
  updateSlide: (id, updates) =>
    set((state) => ({
      slides: state.slides.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    })),
  deleteSlide: (id) =>
    set((state) => {
      const idx = state.slides.findIndex((s) => s.id === id);
      const remaining = state.slides.filter((s) => s.id !== id);
      const wasActive = state.activeSlideId === id;
      // Select the neighbour, like every slide editor does.
      const neighbour = remaining[Math.min(Math.max(idx, 0), remaining.length - 1)];
      const newActive = wasActive ? (neighbour?.id ?? null) : state.activeSlideId;
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
      nodes: src.nodes.map((n) => cloneNodeWithNewIds(n, true)),
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
  setActiveSlide: (activeSlideId) => set({ activeSlideId, selectedNodeIds: [] }),
  editorView: 'canvas',
  setEditorView: (editorView) => set({ editorView, selectedNodeIds: [] }),
  presenting: null,
  setPresenting: (presenting) => set({ presenting }),

  // ── Nodes ──────────────────────────────────────────────────────────────────
  addNode: (slideId, node) =>
    set((state) => ({
      slides: state.slides.map((s) => (s.id === slideId ? { ...s, nodes: [...s.nodes, node] } : s)),
    })),
  updateNode: (slideId, nodeId, updates) =>
    set((state) => ({
      slides: state.slides.map((s) =>
        s.id === slideId
          ? { ...s, nodes: mapNodes(s.nodes, nodeId, (n) => ({ ...n, ...markEdited(n, updates) })) }
          : s
      ),
    })),
  moveNodes: (slideId, moves) => {
    if (moves.size === 0) return;
    const shift = (nodes: SlideNode[]): SlideNode[] =>
      nodes.map((n) => {
        const m = moves.get(n.id);
        const moved = m ? { ...n, x: n.x + m.dx, y: n.y + m.dy } : n;
        return n.children?.length ? { ...moved, children: shift(n.children) } : moved;
      });
    set((state) => ({
      slides: state.slides.map((s) => (s.id === slideId ? { ...s, nodes: shift(s.nodes) } : s)),
    }));
  },
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
  selectNode: (nodeId) => set({ selectedNodeIds: nodeId ? [nodeId] : [] }),
  setSelectedNodes: (ids) => set({ selectedNodeIds: ids }),

  // ── Export ─────────────────────────────────────────────────────────────────
  exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
  setExportSettings: (settings) =>
    set((state) => ({ exportSettings: { ...state.exportSettings, ...settings } })),
  isInserting: false,
  setIsInserting: (isInserting) => set({ isInserting }),
  insertResult: null,
  setInsertResult: (insertResult) => set({ insertResult }),

  deckPlacement: undefined,
  setDeckPlacement: (deckPlacement) => set({ deckPlacement }),
  pullRequestId: null,
  setPullRequestId: (pullRequestId) => set({ pullRequestId }),
  applyPulledSlides: (pulled) => {
    const byId = new Map(pulled.map((p) => [p.slideId, p]));
    const touched = get().slides.filter((s) => byId.has(s.id)).length;
    if (touched === 0) return 0;
    get().commitHistory();
    set((state) => ({
      slides: state.slides.map((slide) => {
        const p = byId.get(slide.id);
        if (!p) return slide;
        return {
          ...slide,
          nodes: inferRoles(p.nodes),
          background: p.background,
          backgroundFills: p.backgroundFills,
          notes: p.notes ?? slide.notes,
        };
      }),
      selectedNodeIds: [],
    }));
    return touched;
  },

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
