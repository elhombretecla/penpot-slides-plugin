import type {
  UIMessage,
  PluginMessage,
  Slide,
  SlideNode,
  CopyStateEntry,
  ExportSettings,
  ImportItemRequest,
  DeckSummary,
  LibraryInfo,
  ComponentInfo,
  ComponentKind,
  LibraryColorInfo,
  LibraryTypographyInfo,
} from './types';
import type {
  Board,
  Fill,
  ImageData,
  Library,
  LibraryComponent,
  LibraryTypography,
  Shape,
  Stroke,
  Text,
} from '@penpot/plugin-types';

// Open the plugin UI at a comfortable size for a slide editor: slide list,
// canvas, speaker notes and the design panel side by side.
penpot.ui.open('Slide Builder', `?theme=${penpot.theme}`, {
  width: 1040,
  height: 720,
});

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
    case 'resize':
      penpot.ui.resize(message.width, message.height);
      break;
  }
});

// ─── Theme Change ─────────────────────────────────────────────────────────────

penpot.on('themechange', (theme) => {
  send({ type: 'theme', theme });
});

// ─── Deck persistence ─────────────────────────────────────────────────────────
// Decks live inside the Penpot file as shared plugin data, so they travel with
// the file (and its collaborators) instead of dying with the plugin window.
// The UI serialises the deck; the plugin only stores strings.

const DATA_NS = 'slidebuilder';
const DECK_INDEX_KEY = 'decks';
const deckKey = (id: string) => `deck:${id}`;

function readDeckIndex(): DeckSummary[] {
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

function handleLoadDeck(deckId: string) {
  let deck: string | null = null;
  try {
    deck = penpot.currentFile?.getSharedPluginData(DATA_NS, deckKey(deckId)) || null;
  } catch (err) {
    sendError('Could not read the presentation: ' + stringifyErr(err));
  }
  send({ type: 'deck-loaded', deckId, deck });
}

function handleSaveDeck(requestId: string, deck: string, summary: DeckSummary) {
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

function handleDeleteDeck(deckId: string) {
  try {
    // Plugin data keys cannot be removed, only emptied (spike Q9).
    penpot.currentFile?.setSharedPluginData(DATA_NS, deckKey(deckId), '');
    writeDeckIndex(readDeckIndex().filter((d) => d.id !== deckId));
  } catch (err) {
    sendError('Could not delete the presentation: ' + stringifyErr(err));
  }
  send({ type: 'decks', decks: readDeckIndex() });
}

// ─── Library Handlers ─────────────────────────────────────────────────────────

function allLibraries() {
  return [penpot.library.local, ...penpot.library.connected];
}

function findLibrary(libraryId: string | undefined) {
  return allLibraries().find((l) => l.id === libraryId) ?? null;
}

function findLibraryComponent(libraryId: string | undefined, componentId: string | undefined) {
  if (!componentId) return null;
  // Prefer the declared library, but fall back to any library holding the id:
  // a template opened from the library file itself reports it as "local".
  const libs = allLibraries();
  const preferred = libs.find((l) => l.id === libraryId);
  const ordered = preferred ? [preferred, ...libs.filter((l) => l !== preferred)] : libs;
  for (const lib of ordered) {
    const comp = lib.components.find((c) => c.id === componentId);
    if (comp) return { lib, comp };
  }
  return null;
}

// Slide layouts are big boards with a screen-like aspect ratio; everything
// else (logos, icons, bullets…) is offered as an insertable element.
function classifyComponent(comp: LibraryComponent): { kind: ComponentKind; width?: number; height?: number } {
  try {
    const main = comp.mainInstance();
    if (!main) return { kind: 'asset' };
    const { width, height } = main;
    const ratio = width / Math.max(1, height);
    const hinted = /slide|layout|cover|plantilla|diapositiva/i.test(`${comp.path}/${comp.name}`);
    const big = width >= 600 && height >= 300;
    const screenLike = ratio >= 1.2 && ratio <= 2.4;
    const isSlide = main.type === 'board' && big && (screenLike || hinted);
    return { kind: isSlide ? 'slide' : 'asset', width, height };
  } catch {
    // The main instance may be unavailable (e.g. not loaded yet).
    return { kind: 'asset' };
  }
}

function handleGetLibraries() {
  try {
    const local = penpot.library.local;
    // `connected` can also list the file's own library — skip it, it is
    // already represented by `local`.
    const connected = penpot.library.connected.filter(
      (lib) => lib.id !== local.id && lib.components.length > 0
    );

    const describe = (lib: Library, isLocal: boolean): LibraryInfo => ({
      id: lib.id,
      name: isLocal ? `${lib.name} (this file)` : lib.name,
      numComponents: lib.components.length,
      numSlides: lib.components.filter((c) => classifyComponent(c).kind === 'slide').length,
      isLocal,
    });

    const libraries = [describe(local, true), ...connected.map((l) => describe(l, false))].filter(
      (lib) => lib.numComponents > 0
    );

    send({
      type: 'libraries',
      libraries,
      fileId: penpot.currentFile?.id ?? '',
      fileName: penpot.currentFile?.name ?? '',
    });
  } catch (err) {
    sendError('Failed to load libraries: ' + stringifyErr(err));
  }
}

async function handleGetAvailableLibraries() {
  try {
    const connected = new Set([penpot.library.local.id, ...penpot.library.connected.map((l) => l.id)]);
    const available = await penpot.library.availableLibraries();
    send({
      type: 'available-libraries',
      libraries: available
        .filter((l) => !connected.has(l.id) && l.numComponents > 0)
        .map((l) => ({ id: l.id, name: l.name, numComponents: l.numComponents })),
    });
  } catch (err) {
    send({ type: 'available-libraries', libraries: [] });
    sendError('Could not list the team libraries: ' + stringifyErr(err));
  }
}

async function handleConnectLibrary(libraryId: string) {
  try {
    await penpot.library.connectLibrary(libraryId);
    send({ type: 'library-connected', libraryId });
    handleGetLibraries();
  } catch (err) {
    sendError('Could not connect the library: ' + stringifyErr(err));
  }
}

function handleGetCatalog(requestId: string, libraryId: string) {
  try {
    const lib = findLibrary(libraryId);
    if (!lib) {
      sendError(`Library not found: ${libraryId}`);
      return;
    }

    const components: ComponentInfo[] = lib.components.map((comp) => ({
      id: comp.id,
      libraryId,
      name: comp.name,
      path: comp.path ?? '',
      ...classifyComponent(comp),
    }));

    const colors: LibraryColorInfo[] = lib.colors.map((c) => ({
      id: c.id,
      libraryId,
      name: c.name,
      path: c.path ?? '',
      color: c.color,
      opacity: c.opacity,
      isFlat: !!c.color && !c.gradient && !c.image,
    }));

    const typographies: LibraryTypographyInfo[] = lib.typographies.map((t) => ({
      id: t.id,
      libraryId,
      name: t.name,
      path: t.path ?? '',
      fontId: t.fontId,
      fontFamily: t.fontFamily,
      fontVariantId: t.fontVariantId,
      fontSize: parseFloat(t.fontSize) || 14,
      fontWeight: String(t.fontWeight ?? '400'),
      fontStyle: t.fontStyle === 'italic' ? 'italic' : 'normal',
      lineHeight: typographyLineHeight(t),
      letterSpacing: parseFloat(t.letterSpacing) || 0,
      textTransform: typographyTransform(t),
    }));

    send({ type: 'catalog', requestId, catalog: { libraryId, components, colors, typographies } });
  } catch (err) {
    sendError('Failed to load components: ' + stringifyErr(err));
  }
}

// Thumbnails are Penpot's own client-side SVG of a temporary instance (the
// main component lives on another page, where text is not rendered). The job
// is cancellable — a newer request supersedes the running one — and
// signature-checked: the UI caches thumbnails across sessions and only
// changed components are re-rendered.
const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_BATCH = 4;
let activeThumbnailRequest: string | null = null;

async function handleGetThumbnails(
  requestId: string,
  libraryId: string,
  known: Record<string, string>,
  force: boolean
) {
  activeThumbnailRequest = requestId;
  const current = () => activeThumbnailRequest === requestId;
  try {
    const lib = findLibrary(libraryId);
    if (!lib) return;

    const todo: { comp: LibraryComponent; main: Shape; signature: string }[] = [];
    for (const comp of lib.components) {
      if (!current()) return;
      try {
        const main = comp.mainInstance();
        if (!main) continue;
        const signature = componentSignature(main);
        if (!force && known[comp.id] === signature) continue;
        todo.push({ comp, main, signature });
      } catch {
        // Unreadable component: the card shows a placeholder.
      }
    }

    for (let i = 0; i < todo.length && current(); i += THUMBNAIL_BATCH) {
      const batch = todo.slice(i, i + THUMBNAIL_BATCH);
      const rendered = await exclusive(() => withUndoBlock(() => renderComponents(batch.map((b) => b.comp))));
      for (let j = 0; j < batch.length && current(); j++) {
        const { comp, main, signature } = batch[j];
        // The server exporter (seconds) is only a last resort.
        const thumbnail =
          rendered[j] ?? (await safeExportPng(main, Math.min(1, THUMBNAIL_WIDTH / Math.max(1, main.width))));
        if (!thumbnail || !current()) continue;
        send({ type: 'thumbnail', requestId, componentId: comp.id, thumbnail, signature });
      }
    }
  } finally {
    if (current()) send({ type: 'thumbnails-complete', requestId });
  }
}

// Cheap content fingerprint of a main component: its client-side SVG markup
// (~50 ms) plus size. Text is not part of the markup for shapes on other
// pages, so pure text edits need a manual refresh.
function componentSignature(main: Shape): string {
  const markup = safeMarkup(main) ?? '';
  return `${Math.round(main.width)}x${Math.round(main.height)}:${hashString(markup)}`;
}

function hashString(value: string): string {
  // FNV-1a, 32 bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + value.length.toString(36);
}

// A library element (logo, icon…) as a single linked component-instance node.
async function handleGetAsset(requestId: string, libraryId: string, componentId: string) {
  try {
    const found = findLibraryComponent(libraryId, componentId);
    if (!found) throw new Error('Component not found in the library.');
    const main = found.comp.mainInstance();
    const [svgMarkup] = await exclusive(() => withUndoBlock(() => renderComponents([found.comp])));
    const node: SlideNode = {
      id: `${componentId}-asset`,
      type: 'component-instance',
      name: found.comp.name,
      x: 0,
      y: 0,
      width: main.width,
      height: main.height,
      visible: true,
      opacity: 1,
      rotation: 0,
      role: 'asset',
      libraryId: found.lib.id,
      componentId,
      componentName: found.comp.name,
      svgMarkup,
      imageUrl: svgMarkup ? svgDataUrl(svgMarkup) : await safeExportPng(main, 1),
    };
    send({ type: 'asset', requestId, node });
  } catch (err) {
    send({ type: 'asset', requestId, node: null, message: stringifyErr(err) });
  }
}

// ─── Render engine ───────────────────────────────────────────────────────────
// Previews are Penpot's own rendering: the slide (or component) is built
// off-canvas on the current page with the same code as "Insert", rendered
// with generateMarkup (client-side, ~60 ms) and removed. Scratch work runs
// one job at a time and inside an undo block, so it never interleaves with an
// insert or import and leaves a single, empty entry in the user's history.

const SCRATCH_X = -200000;
const SCRATCH_Y = -200000;

let scratchQueue: Promise<unknown> = Promise.resolve();

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = scratchQueue.then(fn);
  scratchQueue = run.catch(() => undefined);
  return run;
}

async function withUndoBlock<T>(fn: () => Promise<T>): Promise<T> {
  let block: ReturnType<typeof penpot.history.undoBlockBegin> | null = null;
  try {
    block = penpot.history.undoBlockBegin();
  } catch {
    block = null;
  }
  try {
    return await fn();
  } finally {
    if (block) {
      try {
        penpot.history.undoBlockFinish(block);
      } catch {
        // History is best effort.
      }
    }
  }
}

function removeQuietly(shape: Shape | null | undefined) {
  try {
    shape?.remove();
  } catch {
    // Already gone.
  }
}

// Text layout is asynchronous: freshly created or edited texts reach the
// markup up to ~1 s later. Poll until every visible text shows a word of its
// content and two consecutive renders agree.
const SETTLE_MIN_MS = 150;
const SETTLE_MAX_MS = 3000;
const SETTLE_POLL_MS = 120;
// Every call numbers its defs ("render-123") and stroke ids get fresh
// uuids: compare renders without any of them.
const VOLATILE_IDS_RE = /render-\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

function textProbes(root: Shape): string[] {
  const probes: string[] = [];
  const visit = (shape: Shape) => {
    if (shape.hidden) return;
    if (shape.type === 'text') {
      const word = /[A-Za-z0-9]{2,10}/.exec((shape as Text).characters ?? '')?.[0];
      if (word) probes.push(word);
      return;
    }
    readChildren(shape).forEach(visit);
  };
  visit(root);
  return probes;
}

async function settledMarkup(shape: Shape): Promise<string | undefined> {
  const probes = textProbes(shape);
  const started = Date.now();
  let previous: string | undefined;
  for (;;) {
    const markup = safeMarkup(shape);
    const elapsed = Date.now() - started;
    const complete = markup !== undefined && probes.every((p) => markup.includes(p));
    const stable = markup !== undefined && markup.replace(VOLATILE_IDS_RE, '') === previous;
    if ((complete && stable && elapsed >= SETTLE_MIN_MS) || elapsed >= SETTLE_MAX_MS) {
      return markup;
    }
    previous = markup?.replace(VOLATILE_IDS_RE, '');
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
}

// Markup of temporary instances of each component (media inlined; an
// unreadable picture is left as is rather than failing the preview).
async function renderComponents(comps: LibraryComponent[]): Promise<(string | undefined)[]> {
  const instances: Shape[] = [];
  try {
    comps.forEach((comp, i) => {
      const instance = comp.instance();
      instance.x = SCRATCH_X;
      instance.y = SCRATCH_Y + i * 5000;
      instances.push(instance);
    });
    const out: (string | undefined)[] = [];
    for (const instance of instances) {
      const raw = await settledMarkup(instance);
      out.push(raw ? await inlineMedia(raw, true) : undefined);
    }
    return out;
  } catch {
    return comps.map(() => undefined);
  } finally {
    instances.forEach(removeQuietly);
  }
}

async function handleRenderSlide(requestId: string, slide: Slide) {
  try {
    const result = await exclusive(() =>
      withUndoBlock(async () => {
        const track = new Map<string, string>();
        const board = createBoardForSlide(slide, `Slide preview · ${slide.name}`);
        try {
          board.x = SCRATCH_X;
          board.y = SCRATCH_Y;
          await populateSlide(board, slide, [], track);
          const raw = await settledMarkup(board);
          if (!raw) throw new Error('Penpot returned no markup for the slide.');
          return { svg: (await inlineMedia(raw, true)) ?? raw, shapes: Object.fromEntries(track) };
        } finally {
          removeQuietly(board);
        }
      })
    );
    send({ type: 'slide-render', requestId, slideId: slide.id, ...result });
  } catch (err) {
    send({ type: 'slide-render', requestId, slideId: slide.id, svg: null, shapes: {}, message: stringifyErr(err) });
  }
}

// ─── Serialisation helpers ────────────────────────────────────────────────────

// Plain deep-clone for serialisable payloads (fills, strokes…) so snapshots
// are decoupled from the live Penpot shape and survive postMessage.
function clonePlain<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message || err.toString();
  try {
    return typeof err === 'string' ? err : JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// ─── Component Import Pipeline ────────────────────────────────────────────────

async function handleImportComponents(requestId: string, items: ImportItemRequest[]) {
  send({ type: 'import-start', requestId, total: items.length });

  let success = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    send({
      type: 'import-progress',
      requestId,
      index: i,
      total: items.length,
      componentId: item.componentId,
      componentName: item.componentName,
    });

    try {
      const result = await importSingleComponent(item);
      const found = findLibraryComponent(item.libraryId, item.componentId);
      send({
        type: 'import-item',
        requestId,
        payload: {
          componentId: item.componentId,
          libraryId: found?.lib.id ?? item.libraryId,
          libraryName: found?.lib.name,
          componentName: item.componentName,
          path: found?.comp.path,
          nodes: result.nodes,
          background: result.background,
          backgroundFills: result.backgroundFills,
          backgroundImageUrl: result.backgroundImageUrl,
          width: result.width,
          height: result.height,
        },
        warnings: result.warnings,
      });
      success++;
    } catch (err) {
      failed++;
      send({
        type: 'import-item-error',
        requestId,
        componentId: item.componentId,
        componentName: item.componentName,
        message: stringifyErr(err),
      });
    }
  }

  send({ type: 'import-complete', requestId, success, failed });
}

interface ImportResult {
  nodes: SlideNode[];
  background: string;
  backgroundFills?: unknown[];
  backgroundImageUrl?: string;
  width: number;
  height: number;
  warnings: string[];
}

// Context threaded through the recursive importer.
interface ImportContext {
  // Component the slide comes from; nested shapes whose component is this one
  // are template content, not nested instances.
  rootComponentId: string;
  warnings: string[];
  // Typographies of the template's library, to re-link matching text styles.
  typographies: LibraryTypography[];
}

// Import a component by reading its main instance (cheap, read-only) or, if
// that fails, a temporary off-canvas instance that is removed afterwards. As
// a last resort the whole component becomes a single image node.
async function importSingleComponent(item: ImportItemRequest): Promise<ImportResult> {
  const found = findLibraryComponent(item.libraryId, item.componentId);
  if (!found) {
    throw new Error(`Component "${item.componentName}" not found in any available library.`);
  }
  const { comp, lib } = found;
  const errors: string[] = [];

  let main: Shape | null = null;
  try {
    main = comp.mainInstance() ?? null;
  } catch (err) {
    errors.push(`mainInstance(): ${stringifyErr(err)}`);
  }

  if (main) {
    try {
      return await buildResultFromRoot(main, item, lib);
    } catch (err) {
      errors.push(`read mainInstance tree: ${stringifyErr(err)}`);
    }
  }

  let tempInstance: Shape | null = null;
  try {
    try {
      tempInstance = comp.instance() ?? null;
    } catch (err) {
      errors.push(`instance(): ${stringifyErr(err)}`);
    }
    if (tempInstance) {
      try {
        tempInstance.x = -100000;
        tempInstance.y = -100000;
        return await buildResultFromRoot(tempInstance, item, lib);
      } catch (err) {
        errors.push(`read temporary instance tree: ${stringifyErr(err)}`);
      }
    }
  } finally {
    if (tempInstance) {
      try {
        tempInstance.remove();
      } catch (err) {
        errors.push(`remove temporary instance: ${stringifyErr(err)}`);
      }
    }
  }

  const snapshotRoot = main;
  if (snapshotRoot) {
    const imageUrl = await safeExportPng(snapshotRoot, 1);
    if (imageUrl) {
      const width = snapshotRoot.width ?? item.width ?? 1280;
      const height = snapshotRoot.height ?? item.height ?? 720;
      return {
        nodes: [
          {
            id: `${item.componentId}-snapshot`,
            type: 'image',
            name: item.componentName,
            x: 0,
            y: 0,
            width,
            height,
            visible: true,
            opacity: 1,
            rotation: 0,
            imageUrl,
            sourceType: 'component-snapshot',
          },
        ],
        background: readBackground(snapshotRoot) ?? '#18181a',
        width,
        height,
        warnings: [`"${item.componentName}" could only be imported as a flat image (${errors.join(' · ')}).`],
      };
    }
  }

  throw new Error(errors.length > 0 ? errors.join(' · ') : 'Component could not be read from the library.');
}

async function buildResultFromRoot(root: Shape, item: ImportItemRequest, lib: Library): Promise<ImportResult> {
  const ctx: ImportContext = {
    rootComponentId: item.componentId,
    warnings: [],
    typographies: [...lib.typographies],
  };
  const width = root.width ?? item.width ?? 1280;
  const height = root.height ?? item.height ?? 720;
  const background = readBackground(root) ?? '#18181a';
  const backgroundFills = readFillsSnapshot(root);
  const backgroundImageUrl = await imageFillDataUrl(Array.isArray(root.fills) ? root.fills : []);
  const nodes = await importRootShape(root, ctx);
  return { nodes, background, backgroundFills, backgroundImageUrl, width, height, warnings: ctx.warnings };
}

// If the root is a container, its children become the slide's top-level
// nodes (relative to the root origin). A single-shape component becomes one
// leaf at (0,0).
async function importRootShape(root: Shape, ctx: ImportContext): Promise<SlideNode[]> {
  const rootX = root.x ?? 0;
  const rootY = root.y ?? 0;
  const children = readChildren(root);

  if (children.length > 0) {
    return importChildren(children, rootX, rootY, ctx);
  }

  const node = await importShapeSafe(root, rootX, rootY, ctx);
  return node ? [{ ...node, x: 0, y: 0 }] : [];
}

// Children keep Penpot's order (bottom → top), which is also the plugin's
// model order: the last node paints in front.
async function importChildren(
  children: Shape[],
  parentX: number,
  parentY: number,
  ctx: ImportContext
): Promise<SlideNode[]> {
  const out: SlideNode[] = [];
  for (const child of children) {
    const node = await importShapeSafe(child, parentX, parentY, ctx);
    if (node) out.push(node);
  }
  return out;
}

async function importShapeSafe(
  shape: Shape,
  parentX: number,
  parentY: number,
  ctx: ImportContext
): Promise<SlideNode | null> {
  try {
    return await importShape(shape, parentX, parentY, ctx);
  } catch (err) {
    ctx.warnings.push(`Skipped "${safeName(shape) ?? shape.type}": ${stringifyErr(err)}`);
    return null;
  }
}

// Recursive importer: converts a Penpot shape into a SlideNode tree.
// Coordinates are relative to the parent and describe the UNROTATED box:
// Penpot reports x/y of the rotated bounding box, so the origin is derived
// from the centre. Rotation is applied around the centre both in the editor
// (CSS) and on export (Penpot), so the shape lands exactly where it was.
async function importShape(
  shape: Shape,
  parentX: number,
  parentY: number,
  ctx: ImportContext
): Promise<SlideNode | null> {
  const width = shape.width ?? 0;
  const height = shape.height ?? 0;
  const rotation = shape.rotation ?? 0;
  const absX = rotation ? shape.center.x - width / 2 : shape.x ?? 0;
  const absY = rotation ? shape.center.y - height / 2 : shape.y ?? 0;

  const base = {
    id: shape.id,
    name: shape.name ?? 'Element',
    x: absX - parentX,
    y: absY - parentY,
    width,
    height,
    visible: !shape.hidden,
    opacity: shape.opacity ?? 1,
    rotation,
    sourceType: shape.type,
    slotId: slotIdOf(shape),
  };

  const fills = 'fills' in shape && Array.isArray(shape.fills) ? shape.fills : [];
  const firstFill = fills[0];
  const fillColor = firstFill?.fillColor;
  const fillOpacity = firstFill?.fillOpacity ?? 1;
  const fillsSnapshot = fills.length > 0 ? clonePlain(fills) : undefined;
  // Image fills are opaque ids to the UI; read the bytes (client-side, a few
  // ms) so the editor can show the actual picture.
  const fillImageUrl = await imageFillDataUrl(fills);

  const strokes = 'strokes' in shape && Array.isArray(shape.strokes) ? shape.strokes : [];
  const firstStroke = strokes[0];
  const strokesSnapshot = strokes.length > 0 ? clonePlain(strokes) : undefined;

  // Nested component instance (e.g. a logo inside the template): keep it as
  // a link so export re-instantiates the real component.
  const componentRef = detectNestedInstance(shape, ctx.rootComponentId);
  if (componentRef) {
    const svgMarkup = safeMarkup(shape);
    const preview = svgMarkup ? await inlineMedia(svgMarkup) : undefined;
    return {
      ...base,
      type: 'component-instance',
      libraryId: componentRef.libraryId,
      componentId: componentRef.componentId,
      componentName: componentRef.name,
      copyState: captureCopyState(shape),
      copyBase: { width, height },
      svgMarkup,
      imageUrl: preview ? svgDataUrl(preview) : await safeExportPng(shape, 0.5),
    };
  }

  if (shape.type === 'group') {
    return {
      ...base,
      type: 'group',
      children: await importChildren(readChildren(shape), absX, absY, ctx),
    };
  }

  // Nested boards keep hierarchy, clipping and their background.
  if (shape.type === 'board') {
    return {
      ...base,
      type: 'group',
      clipContent: shape.clipContent,
      borderRadius: shape.borderRadius ?? 0,
      imageUrl: fillImageUrl,
      fill: fillColor,
      fillOpacity,
      fills: fillsSnapshot,
      strokes: strokesSnapshot,
      children: await importChildren(readChildren(shape), absX, absY, ctx),
    };
  }

  if (shape.type === 'text') {
    const style = readTextStyle(shape);
    const typography = matchTypography(style, ctx.typographies);
    return {
      ...base,
      type: 'text',
      ...style,
      typographyId: typography?.id,
      typographyLibraryId: typography?.libraryId,
      fills: fillsSnapshot,
      strokes: strokesSnapshot,
    };
  }

  if (shape.type === 'ellipse') {
    return {
      ...base,
      type: 'ellipse',
      imageUrl: fillImageUrl,
      fill: fillColor ?? (fillImageUrl ? undefined : '#6457f0'),
      fillOpacity,
      strokeColor: firstStroke?.strokeColor,
      strokeWidth: firstStroke?.strokeWidth,
      fills: fillsSnapshot,
      strokes: strokesSnapshot,
    };
  }

  if (shape.type === 'rectangle') {
    return {
      ...base,
      type: 'rect',
      imageUrl: fillImageUrl,
      fill: fillColor ?? (fillImageUrl ? undefined : '#6457f0'),
      fillOpacity,
      strokeColor: firstStroke?.strokeColor,
      strokeWidth: firstStroke?.strokeWidth,
      borderRadius: shape.borderRadius ?? 0,
      fills: fillsSnapshot,
      strokes: strokesSnapshot,
    };
  }

  if (shape.type === 'image') {
    return {
      ...base,
      type: 'image',
      imageUrl: await safeExportPng(shape, 1),
      fill: fillColor,
      fillOpacity,
      fills: fillsSnapshot,
      strokes: strokesSnapshot,
    };
  }

  // Paths, booleans, raw SVG and anything unknown: keep the vector source so
  // export can rebuild real vectors. Raster export is only a fallback — and
  // the only option when the vector carries an image fill: the markup then
  // points at an authenticated asset URL that createShapeFromSvg can't load.
  let svgMarkup = safeMarkup(shape);
  // The rotated bounding box, for geometry that already has the rotation
  // baked in (SVG markup, path data).
  const rotatedBox = {
    x: shape.bounds.x - parentX,
    y: shape.bounds.y - parentY,
    width: shape.bounds.width,
    height: shape.bounds.height,
    rotation: 0,
  };
  if (svgMarkup && hasMedia(svgMarkup)) {
    // Image-filled vector: its image is not exposed in `fills`, only in the
    // markup. Keep the path geometry plus that image as a real image fill,
    // and inline the bytes for the editor preview (no server export).
    const preview = await inlineMedia(svgMarkup);
    const media = firstMedia(svgMarkup);
    if (shape.type === 'path' && preview && media) {
      return {
        ...base,
        ...(rotation ? rotatedBox : {}),
        type: 'path',
        pathData: shape.d,
        imageUrl: svgDataUrl(preview),
        fills: [{ fillOpacity: 1, fillImage: media }],
        strokes: strokesSnapshot,
      };
    }
    svgMarkup = undefined;
    if (preview) {
      return { ...base, ...(rotation ? rotatedBox : {}), type: 'path', imageUrl: svgDataUrl(preview), strokes: strokesSnapshot };
    }
  }
  // The markup already bakes the rotation in, so describe these nodes by
  // their rotated bounding box with rotation 0 — otherwise they would be
  // rotated twice (editor and export).
  const bakedGeometry = svgMarkup && rotation ? rotatedBox : {};
  return {
    ...base,
    ...bakedGeometry,
    type: 'path',
    svgMarkup,
    imageUrl: svgMarkup ? svgDataUrl(svgMarkup) : await safeExportPng(shape, 1),
    fill: fillColor,
    fillOpacity,
    strokeColor: firstStroke?.strokeColor,
    strokeWidth: firstStroke?.strokeWidth,
    fills: fillsSnapshot,
    strokes: strokesSnapshot,
  };
}

// Text properties may be 'mixed' when the text has several style runs. In
// that case the first character's style is used instead of hard-coded
// defaults, so at least the dominant opening style survives.
function readTextStyle(text: Text): Partial<SlideNode> {
  let first: ReturnType<Text['getRange']> | null = null;
  const firstRange = () => {
    if (!first && text.characters.length > 0) first = text.getRange(0, 1);
    return first;
  };
  const pick = <T>(value: T | 'mixed', fromRange: () => T | 'mixed' | undefined): T | undefined => {
    if (value !== 'mixed') return value;
    const v = fromRange();
    return v === 'mixed' ? undefined : v;
  };
  const num = (value: string | undefined, fallback: number) => {
    const n = value != null ? parseFloat(value) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };

  const align = pick(text.align, () => firstRange()?.align);
  const fontStyle = pick(text.fontStyle, () => firstRange()?.fontStyle);
  const textTransform = pick(text.textTransform, () => firstRange()?.textTransform);
  const textDecoration = pick(text.textDecoration, () => firstRange()?.textDecoration);
  const verticalAlign = text.verticalAlign;
  const fills = pick(text.fills, () => firstRange()?.fills);
  const firstFillColor = Array.isArray(fills) ? fills[0]?.fillColor : undefined;

  return {
    text: text.characters ?? '',
    fontId: pick(text.fontId, () => firstRange()?.fontId),
    fontFamily: pick(text.fontFamily, () => firstRange()?.fontFamily) ?? 'sourcesanspro',
    fontVariantId: pick(text.fontVariantId, () => firstRange()?.fontVariantId),
    fontSize: num(pick(text.fontSize, () => firstRange()?.fontSize), 14),
    fontWeight: pick(text.fontWeight, () => firstRange()?.fontWeight) ?? '400',
    fontStyle: fontStyle === 'italic' ? 'italic' : 'normal',
    lineHeight: num(pick(text.lineHeight, () => firstRange()?.lineHeight), 1.2),
    letterSpacing: num(pick(text.letterSpacing, () => firstRange()?.letterSpacing), 0),
    textAlign: align === 'center' || align === 'right' ? align : 'left',
    textTransform:
      textTransform === 'uppercase' || textTransform === 'lowercase' || textTransform === 'capitalize'
        ? textTransform
        : undefined,
    textDecoration:
      textDecoration === 'underline' || textDecoration === 'line-through' ? textDecoration : undefined,
    verticalAlign: verticalAlign === 'center' || verticalAlign === 'bottom' ? verticalAlign : 'top',
    growType: text.growType,
    fontColor: firstFillColor ?? '#000000',
  };
}

// Slot id = the shape's counterpart in the template's main component. Reading
// the main instance the shape *is* that counterpart; inside a copy (fallback
// path) `componentRefShape()` points at it.
function slotIdOf(shape: Shape): string {
  try {
    if (shape.isComponentCopyInstance()) {
      const ref = shape.componentRefShape();
      if (ref) return ref.id;
    }
  } catch {
    // Component lookups can throw for shapes outside the current page.
  }
  return shape.id;
}

// A text whose style equals a library typography is treated as using it, so
// export can re-apply the style and keep the library link. Every visible
// property must match: a false positive would restyle the text.
function matchTypography(style: Partial<SlideNode>, typographies: LibraryTypography[]): LibraryTypography | null {
  const near = (a: number | undefined, b: number) => a != null && Math.abs(a - b) < 0.01;
  return (
    typographies.find(
      (t) =>
        t.fontId === style.fontId &&
        near(style.fontSize, parseFloat(t.fontSize) || 0) &&
        String(t.fontWeight) === style.fontWeight &&
        (t.fontStyle ?? 'normal') === (style.fontStyle ?? 'normal') &&
        near(style.lineHeight, typographyLineHeight(t)) &&
        near(style.letterSpacing, parseFloat(t.letterSpacing) || 0) &&
        typographyTransform(t) === style.textTransform
    ) ?? null
  );
}

// Library typographies report unset values as null / "none"; texts report
// the effective defaults (1.2 line height, no transform).
function typographyLineHeight(t: LibraryTypography): number {
  return parseFloat(t.lineHeight) || 1.2;
}

function typographyTransform(t: LibraryTypography): SlideNode['textTransform'] {
  const v = t.textTransform;
  return v === 'uppercase' || v === 'lowercase' || v === 'capitalize' ? v : undefined;
}

// A nested instance is the head of a component copy whose component is not
// the slide template itself. (`component` / `componentHead` are methods in
// the Plugin API — reading them as properties never matches.)
function detectNestedInstance(
  shape: Shape,
  rootComponentId: string
): { libraryId: string; componentId: string; name: string } | null {
  try {
    if (!shape.isComponentInstance()) return null;
    if (shape.componentHead()?.id !== shape.id) return null;
    const comp = shape.component();
    if (!comp || comp.id === rootComponentId) return null;
    return { libraryId: comp.libraryId, componentId: comp.id, name: comp.name };
  } catch {
    // Shapes outside the current page may throw on component lookups; treat
    // them as plain shapes.
    return null;
  }
}

// Depth-first snapshot of a component copy's descendants: geometry relative
// to the copy root plus the properties templates usually override.
function captureCopyState(root: Shape): CopyStateEntry[] {
  const out: CopyStateEntry[] = [];
  const visit = (parent: Shape) => {
    for (const child of readChildren(parent)) {
      out.push({
        dx: child.x - root.x,
        dy: child.y - root.y,
        width: child.width,
        height: child.height,
        rotated: !!child.rotation,
        hidden: !!child.hidden,
        fills: Array.isArray(child.fills) ? clonePlain(child.fills) : undefined,
        strokes: Array.isArray(child.strokes) ? clonePlain(child.strokes) : undefined,
        characters: child.type === 'text' ? child.characters : undefined,
      });
      visit(child);
    }
  };
  visit(root);
  return out;
}

function safeName(shape: Shape): string | undefined {
  try {
    return shape.name ?? undefined;
  } catch {
    return undefined;
  }
}

// Client-side SVG of a shape (~50 ms, no server round-trip). Text inside the
// markup is only present when the shape lives on the current page, which is
// fine here: it is used for vectors, not for text.
function safeMarkup(shape: Shape): string | undefined {
  try {
    const svg = penpot.generateMarkup([shape], { type: 'svg' });
    return svg && svg.includes('<svg') ? onlyRootTree(svg, shape.id) : undefined;
  } catch {
    return undefined;
  }
}

// generateMarkup([shape]) emits the shape's tree and then every descendant
// again as a top-level group — outside the board's clip and painted over the
// original (semi-transparent layers double up). Keep the root's tree only.
const TAG_RE = /<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

function onlyRootTree(svg: string, rootId: string): string {
  const cuts: [number, number][] = [];
  let depth = 0;
  let cutStart = -1;
  let rootSeen = false;
  TAG_RE.lastIndex = 0;
  for (let m = TAG_RE.exec(svg); m; m = TAG_RE.exec(svg)) {
    const [full, closing, name, attrs, selfClosing] = m;
    if (closing) {
      depth--;
      if (cutStart >= 0 && depth === 1) {
        cuts.push([cutStart, m.index + full.length]);
        cutStart = -1;
      }
      continue;
    }
    if (depth === 1 && cutStart < 0 && name === 'g') {
      const id = /\bid="shape-([0-9a-f-]{36})"/.exec(attrs)?.[1];
      if (id === rootId) rootSeen = true;
      else if (id) cutStart = m.index;
    }
    if (!selfClosing) depth++;
  }
  if (!rootSeen || cuts.length === 0) return svg;
  let out = '';
  let from = 0;
  for (const [start, end] of cuts) {
    out += svg.slice(from, start);
    from = end;
  }
  return out + svg.slice(from);
}

// Percent-encoding instead of base64: no TextEncoder needed in the sandbox.
function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ─── Media inlining ──────────────────────────────────────────────────────────
// Markup references images by authenticated asset URLs that the plugin UI
// cannot load. The bytes are reachable through `ImageData.data()`: a
// throw-away rectangle gets an image fill with the media id and is read back
// (~40 ms per image, cached for the session).

const MEDIA_URL_RE = /https?:\/\/[^"'\s)]*\/assets\/by-file-media-id\/([0-9a-f-]{36})/g;
const mediaCache = new Map<string, string | null>();

function hasMedia(svg: string): boolean {
  return svg.includes('by-file-media-id');
}

function firstMedia(svg: string): ImageData | null {
  const m = /by-file-media-id\/([0-9a-f-]{36})/.exec(svg);
  if (!m) return null;
  const tag = new RegExp(`<image[^>]*${m[1]}[^>]*>`).exec(svg)?.[0] ?? '';
  // Penpot only accepts integer image sizes in fills.
  const num = (attr: string) =>
    Math.max(1, Math.round(parseFloat(new RegExp(`\\b${attr}="([0-9.]+)"`).exec(tag)?.[1] ?? '') || 100));
  return { id: m[1], width: num('width'), height: num('height'), mtype: 'image/png', keepAspectRatio: false } as unknown as ImageData;
}

function sniffMime(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[8] === 0x57) return 'image/webp';
  if (bytes[0] === 0x3c) return 'image/svg+xml';
  return 'image/png';
}

async function mediaDataUrl(id: string): Promise<string | null> {
  if (mediaCache.has(id)) return mediaCache.get(id) ?? null;
  let result: string | null = null;
  let probe: Shape | null = null;
  try {
    probe = penpot.createRectangle();
    probe.x = -100000;
    probe.y = -100000;
    probe.fills = [{ fillOpacity: 1, fillImage: { id, width: 1, height: 1, mtype: 'image/png', keepAspectRatio: false } as unknown as ImageData }];
    const image = Array.isArray(probe.fills) ? probe.fills[0]?.fillImage : undefined;
    if (image) {
      const bytes = await image.data();
      result = `data:${sniffMime(bytes)};base64,${uint8ArrayToBase64(bytes)}`;
    }
  } catch {
    result = null;
  } finally {
    try {
      probe?.remove();
    } catch {
      // Nothing else to clean up.
    }
  }
  mediaCache.set(id, result);
  return result;
}

// The markup with every asset URL replaced by a data URL, or undefined when
// some image could not be read (`loose` keeps the unreadable ones instead).
async function inlineMedia(svg: string, loose = false): Promise<string | undefined> {
  if (!hasMedia(svg)) return svg;
  const ids = [...new Set([...svg.matchAll(MEDIA_URL_RE)].map((m) => m[1]))];
  const urls = new Map<string, string>();
  for (const id of ids) {
    const url = await mediaDataUrl(id);
    if (url) urls.set(id, url);
    else if (!loose) return undefined;
  }
  return svg.replace(MEDIA_URL_RE, (_match, id: string) => urls.get(id) ?? _match);
}

async function imageFillDataUrl(fills: Fill[]): Promise<string | undefined> {
  const image = fills.find((f) => f.fillImage)?.fillImage;
  if (!image) return undefined;
  try {
    const bytes = await image.data();
    return `data:${image.mtype || 'image/png'};base64,${uint8ArrayToBase64(bytes)}`;
  } catch {
    return undefined;
  }
}

// Server-side raster export — slow (seconds), used only as a fallback.
async function safeExportPng(shape: Shape, scale: number): Promise<string | undefined> {
  try {
    const bytes = await shape.export({ type: 'png', scale });
    return `data:image/png;base64,${uint8ArrayToBase64(bytes)}`;
  } catch {
    return undefined;
  }
}

function readChildren(shape: Shape): Shape[] {
  try {
    return 'children' in shape && Array.isArray(shape.children) ? shape.children : [];
  } catch {
    // Accessing `.children` may throw on certain shapes; treat as leaf.
    return [];
  }
}

function readBackground(shape: Shape): string | null {
  try {
    const fills = shape.fills;
    if (Array.isArray(fills) && typeof fills[0]?.fillColor === 'string') return fills[0].fillColor;
  } catch {
    // Unreadable fills → caller uses its default background.
  }
  return null;
}

function readFillsSnapshot(shape: Shape): unknown[] | undefined {
  try {
    const fills = shape.fills;
    if (Array.isArray(fills) && fills.length > 0) return clonePlain(fills);
  } catch {
    // Unreadable fills → no snapshot, the flat background is used.
  }
  return undefined;
}

// ─── Canvas Insertion ─────────────────────────────────────────────────────────

const DECK_PADDING = 40;

async function handleInsertIntoCanvas(
  deckId: string,
  deckName: string,
  slides: Slide[],
  settings: ExportSettings
) {
  const warnings: string[] = [];
  try {
    if (slides.length === 0) {
      send({ type: 'insert-complete', count: 0, warnings });
      return;
    }

    if (settings.createNewPage) {
      const page = penpot.createPage();
      page.name = deckName || 'Slides';
      // Shape creation always targets the active page.
      await penpot.openPage(page);
    }

    const gap = settings.spacing;
    const totalWidth = slides.reduce((sum, s, i) => sum + s.width + (i > 0 ? gap : 0), 0);
    const maxHeight = Math.max(...slides.map((s) => s.height));
    const center = penpot.viewport.center;

    const boards: Board[] = [];
    let deck: Board | null = null;

    if (settings.wrapInDeck) {
      deck = createDeck(totalWidth, maxHeight, gap, center);
    }

    let cursorX = center.x - totalWidth / 2;
    const topY = center.y - maxHeight / 2;

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const name = `${settings.slidePrefix} ${String(i + 1).padStart(2, '0')}`;
      const board = createBoardForSlide(slide, name);
      tagBoard(board, deckId, slide);

      if (deck) {
        // Flex assigns the real position; keep each slide at its own size.
        deck.appendChild(board);
        if (board.layoutChild) {
          board.layoutChild.horizontalSizing = 'fix';
          board.layoutChild.verticalSizing = 'fix';
        }
      } else {
        board.x = cursorX;
        board.y = topY;
        cursorX += slide.width + gap;
      }

      try {
        await populateSlide(board, slide, warnings);
      } catch (err) {
        warnings.push(`${name}: ${stringifyErr(err)}`);
      }
      boards.push(board);
    }

    if (settings.createFlow && !deck && boards.length > 0) {
      try {
        const page = penpot.currentPage;
        if (page) {
          const flowName = deckName || 'Presentation';
          // Re-inserting the same deck replaces its flow instead of piling up.
          page.flows.filter((f) => f.name === flowName).forEach((f) => page.removeFlow(f));
          page.createFlow(flowName, boards[0]);
        }
      } catch (err) {
        warnings.push(`Could not create the presentation flow: ${stringifyErr(err)}`);
      }
    }

    try {
      penpot.selection = deck ? [deck] : boards;
    } catch {
      // Selection is cosmetic; ignore if unavailable.
    }

    send({ type: 'insert-complete', count: boards.length, warnings: dedupe(warnings) });
  } catch (err) {
    sendError('Failed to insert slides: ' + stringifyErr(err));
  }
}

function createDeck(totalWidth: number, maxHeight: number, gap: number, center: { x: number; y: number }): Board {
  const deckWidth = totalWidth + DECK_PADDING * 2;
  const deckHeight = maxHeight + DECK_PADDING * 2;

  const deck = penpot.createBoard();
  deck.name = 'Slides deck';
  deck.x = center.x - deckWidth / 2;
  deck.y = center.y - deckHeight / 2;
  deck.resize(deckWidth, deckHeight);
  // Transparent wrapper that hugs its content and never clips the slides.
  deck.fills = [];
  deck.horizontalSizing = 'auto';
  deck.clipContent = false;

  const flex = deck.addFlexLayout();
  flex.dir = 'row';
  flex.wrap = 'nowrap';
  flex.alignItems = 'start';
  flex.justifyContent = 'start';
  flex.topPadding = DECK_PADDING;
  flex.rightPadding = DECK_PADDING;
  flex.bottomPadding = DECK_PADDING;
  flex.leftPadding = DECK_PADDING;
  flex.rowGap = gap;
  flex.columnGap = gap;
  return deck;
}

// Inserted boards remember which deck/slide they come from (groundwork for
// updating them in place) and carry the speaker notes.
function tagBoard(board: Board, deckId: string, slide: Slide) {
  try {
    board.setSharedPluginData(
      DATA_NS,
      'slide',
      JSON.stringify({ deckId, slideId: slide.id, componentId: slide.template?.componentId ?? null })
    );
    if (slide.notes) board.setSharedPluginData(DATA_NS, 'notes', slide.notes);
  } catch {
    // Tags are an optional extra; the slide itself is already inserted.
  }
}

function createBoardForSlide(slide: Slide, name: string): Board {
  const board = penpot.createBoard();
  board.name = name;
  board.resize(slide.width, slide.height);
  board.clipContent = true;

  // Full fills snapshot first (gradients, images, linked library colors);
  // the flat hex is only for slides created from scratch.
  board.fills =
    slide.backgroundFills && slide.backgroundFills.length > 0
      ? (clonePlain(slide.backgroundFills) as Fill[])
      : [{ fillColor: slide.background, fillOpacity: 1 }];
  return board;
}

async function populateSlide(
  board: Board,
  slide: Slide,
  warnings: string[],
  track?: Map<string, string>
) {
  // Library slide without extracted nodes: drop in a linked instance.
  if (slide.template && slide.nodes.length === 0) {
    const found = findLibraryComponent(slide.template.libraryId, slide.template.componentId);
    if (!found) {
      warnings.push(`"${slide.name}": template component not found — the slide is empty.`);
      return;
    }
    const instance = found.comp.instance();
    board.appendChild(instance);
    instance.x = board.x;
    instance.y = board.y;
    return;
  }

  // SlideNode coordinates are slide-relative; Penpot coordinates are
  // absolute, so offset by the board's (post-layout) position.
  await populateNodes(board, slide.nodes, board.x, board.y, warnings, track);
}

// Recursive populator. Nodes are appended in model order (bottom → top):
// Penpot's `appendChild` puts each new shape in front of the previous ones,
// so the stacking order is preserved 1:1.
async function populateNodes(
  parent: Board,
  nodes: SlideNode[],
  offsetX: number,
  offsetY: number,
  warnings: string[],
  // Records created shape id → node id (top level only, for the renderer).
  track?: Map<string, string>
): Promise<Shape[]> {
  const created: Shape[] = [];
  for (const node of nodes) {
    if (!node.visible) continue;
    try {
      const shape = await createShapeForNode(parent, node, offsetX + node.x, offsetY + node.y, warnings);
      if (shape) {
        created.push(shape);
        track?.set(shape.id, node.id);
      }
    } catch (err) {
      warnings.push(`Could not create "${node.name}": ${stringifyErr(err)}`);
    }
  }
  return created;
}

async function createShapeForNode(
  parent: Board,
  node: SlideNode,
  absX: number,
  absY: number,
  warnings: string[]
): Promise<Shape | null> {
  switch (node.type) {
    case 'group': {
      // Nested boards come back as boards (clip + background), plain groups
      // as Penpot groups.
      if (node.clipContent !== undefined || (node.fills && node.fills.length > 0)) {
        const inner = penpot.createBoard();
        inner.name = node.name;
        parent.appendChild(inner);
        place(inner, node, absX, absY);
        inner.clipContent = node.clipContent ?? false;
        if (node.borderRadius) inner.borderRadius = node.borderRadius;
        inner.fills = node.fills && node.fills.length > 0 ? (clonePlain(node.fills) as Fill[]) : [];
        if (node.imageReplaced) inner.fills = await withReplacedImage(inner.fills as Fill[], node, warnings);
        if (node.strokes?.length) inner.strokes = clonePlain(node.strokes) as Stroke[];
        await populateNodes(inner, node.children ?? [], absX, absY, warnings);
        return inner;
      }
      const children = await populateNodes(parent, node.children ?? [], absX, absY, warnings);
      if (children.length === 0) return null;
      const group = penpot.group(children);
      if (!group) return null;
      group.name = node.name;
      group.opacity = node.opacity;
      return group;
    }

    case 'text': {
      const text = penpot.createText(node.text || ' ');
      if (!text) return null;
      text.name = node.name;
      parent.appendChild(text);
      applyTextStyle(text, node, warnings);
      applyFillsAndStrokes(text, node, { fill: node.fontColor ?? '#000000' });
      place(text, node, absX, absY);
      // resize() forces growType 'fixed'; restore the template's behaviour.
      if (node.growType && node.growType !== 'fixed') text.growType = node.growType;
      return text;
    }

    case 'rect': {
      const rect = penpot.createRectangle();
      rect.name = node.name;
      parent.appendChild(rect);
      applyFillsAndStrokes(rect, node, { fill: '#d0d0d0' });
      if (node.imageReplaced) rect.fills = await withReplacedImage(rect.fills as Fill[], node, warnings);
      if (node.borderRadius) rect.borderRadius = node.borderRadius;
      place(rect, node, absX, absY);
      return rect;
    }

    case 'ellipse': {
      const ellipse = penpot.createEllipse();
      ellipse.name = node.name;
      parent.appendChild(ellipse);
      applyFillsAndStrokes(ellipse, node, { fill: '#ffffff' });
      if (node.imageReplaced) ellipse.fills = await withReplacedImage(ellipse.fills as Fill[], node, warnings);
      place(ellipse, node, absX, absY);
      return ellipse;
    }

    case 'component-instance': {
      const found = findLibraryComponent(node.libraryId, node.componentId);
      if (found) {
        const instance = found.comp.instance();
        instance.name = node.name;
        parent.appendChild(instance);
        instance.x = absX;
        instance.y = absY;
        // The copy state was captured at the template's instance size; replay
        // it there, then scale everything to the size set in the editor.
        const baseW = node.copyBase?.width ?? instance.width;
        const baseH = node.copyBase?.height ?? instance.height;
        if (node.copyState) {
          instance.resize(Math.max(0.01, baseW), Math.max(0.01, baseH));
          replayCopyState(instance, node.copyState, node.name, warnings);
        }
        scaleInstanceTo(instance, node.width, node.height);
        instance.opacity = node.opacity;
        if (node.rotation) instance.rotation = node.rotation;
        return instance;
      }
      warnings.push(`Component "${node.componentName ?? node.name}" not found — inserted a detached copy.`);
      return createVectorOrImage(parent, node, absX, absY, warnings);
    }

    case 'image':
    case 'path':
      return createVectorOrImage(parent, node, absX, absY, warnings);
  }
}

// Re-apply a captured copy state onto a fresh instance of the same component
// (same structure, same depth-first order). Only values that differ are
// written, so untouched properties stay inherited from the main component.
// Geometry is replayed too: resizing an instance root does not scale its
// children, while the template's copy may be scaled.
function replayCopyState(instance: Shape, state: CopyStateEntry[], name: string, warnings: string[]) {
  const targets: Shape[] = [];
  const visit = (parent: Shape) => {
    for (const child of readChildren(parent)) {
      targets.push(child);
      visit(child);
    }
  };
  visit(instance);
  if (targets.length !== state.length) {
    warnings.push(`"${name}": the component changed since import — its overrides were not re-applied.`);
    return;
  }

  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  targets.forEach((target, i) => {
    const entry = state[i];
    if (!entry.rotated && !target.rotation) {
      if (Math.abs(target.width - entry.width) > 0.5 || Math.abs(target.height - entry.height) > 0.5) {
        target.resize(Math.max(0.01, entry.width), Math.max(0.01, entry.height));
      }
      const x = instance.x + entry.dx;
      const y = instance.y + entry.dy;
      if (Math.abs(target.x - x) > 0.5) target.x = x;
      if (Math.abs(target.y - y) > 0.5) target.y = y;
    }
    if (target.hidden !== entry.hidden) target.hidden = entry.hidden;
    if (entry.characters !== undefined && target.type === 'text' && target.characters !== entry.characters) {
      target.characters = entry.characters;
    }
    if (entry.fills && !same(target.fills, entry.fills)) target.fills = clonePlain(entry.fills) as Fill[];
    if (entry.strokes && !same(target.strokes, entry.strokes)) target.strokes = clonePlain(entry.strokes) as Stroke[];
  });
}

// Resize a component copy *with* its content: `resize()` on the root alone
// leaves the children at their size (constraints are left/top).
function scaleInstanceTo(instance: Shape, width: number, height: number) {
  const sx = width / Math.max(0.01, instance.width);
  const sy = height / Math.max(0.01, instance.height);
  if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return;
  const originX = instance.x;
  const originY = instance.y;
  const descendants: { shape: Shape; dx: number; dy: number; w: number; h: number }[] = [];
  const visit = (parent: Shape) => {
    for (const child of readChildren(parent)) {
      if (!child.rotation) {
        descendants.push({ shape: child, dx: child.x - originX, dy: child.y - originY, w: child.width, h: child.height });
      }
      visit(child);
    }
  };
  visit(instance);
  instance.resize(Math.max(0.01, width), Math.max(0.01, height));
  for (const d of descendants) {
    d.shape.resize(Math.max(0.01, d.w * sx), Math.max(0.01, d.h * sy));
    d.shape.x = originX + d.dx * sx;
    d.shape.y = originY + d.dy * sy;
  }
}

// Vectors are rebuilt from their SVG source; raster-only nodes become a
// rectangle with an image fill (uploaded from the snapshot if needed).
async function createVectorOrImage(
  parent: Board,
  node: SlideNode,
  absX: number,
  absY: number,
  warnings: string[]
): Promise<Shape | null> {
  if (node.pathData) {
    const path = penpot.createPath();
    path.name = node.name;
    parent.appendChild(path);
    path.d = node.pathData;
    const fills = clonePlain((node.fills ?? []) as Fill[]);
    path.fills = node.imageReplaced ? await withReplacedImage(fills, node, warnings) : fills;
    // New paths come with a default black stroke; always set the real ones.
    path.strokes = clonePlain((node.strokes ?? []) as Stroke[]);
    place(path, node, absX, absY);
    return path;
  }

  if (node.svgMarkup && !node.imageReplaced && !hasMedia(node.svgMarkup)) {
    const vector = penpot.createShapeFromSvg(node.svgMarkup);
    if (vector) {
      vector.name = node.name;
      parent.appendChild(vector);
      vector.opacity = node.opacity;
      vector.x = absX;
      vector.y = absY;
      vector.resize(node.width, node.height);
      return vector;
    }
  }

  const rect = penpot.createRectangle();
  rect.name = node.name;
  parent.appendChild(rect);

  const hasImageFill = (node.fills ?? []).some((f) => (f as { fillImage?: unknown }).fillImage);
  if (hasImageFill && !node.imageReplaced) {
    rect.fills = clonePlain(node.fills) as Fill[];
  } else if (node.imageUrl) {
    const image = await uploadDataUrl(node.name, node.imageUrl);
    if (image) rect.fills = [{ fillOpacity: 1, fillImage: image }];
    else warnings.push(`Penpot rejected the picture of "${node.name}".`);
    if (node.borderRadius) rect.borderRadius = node.borderRadius;
  } else {
    warnings.push(`"${node.name}" has no visual source — inserted an empty placeholder.`);
    rect.fills = [];
  }
  if (node.strokes?.length) rect.strokes = clonePlain(node.strokes) as Stroke[];
  place(rect, node, absX, absY);
  return rect;
}

// Uploads are cached per content: live renders rebuild the slide after every
// edit and must not re-upload the same picture each time. Rejected files are
// remembered too (Penpot takes seconds to refuse an unsupported image).
const uploadCache = new Map<string, Promise<ImageData | null>>();

function uploadDataUrl(name: string, dataUrl: string): Promise<ImageData | null> {
  const key = hashString(dataUrl);
  let upload = uploadCache.get(key);
  if (!upload) {
    upload = (async () => {
      const match = /^data:([^;,]+)(;base64)?,(.*)$/.exec(dataUrl);
      if (!match) return null;
      const bytes = match[2]
        ? base64ToUint8Array(match[3])
        : new Uint8Array([...decodeURIComponent(match[3])].map((c) => c.charCodeAt(0) & 0xff));
      try {
        return (await penpot.uploadMediaData(name, bytes, match[1])) ?? null;
      } catch {
        return null;
      }
    })();
    uploadCache.set(key, upload);
  }
  return upload;
}

// Swap the template's image fill for the picture chosen in the editor,
// keeping every other fill (overlays, tints) of the stack.
async function withReplacedImage(fills: Fill[], node: SlideNode, warnings: string[]): Promise<Fill[]> {
  if (!node.imageUrl) return fills;
  const image = await uploadDataUrl(node.name, node.imageUrl);
  if (!image) {
    warnings.push(`Penpot rejected the picture of "${node.name}" — the template image was kept.`);
    return fills;
  }
  const replacement: Fill = { fillOpacity: 1, fillImage: image };
  const idx = fills.findIndex((f) => f.fillImage);
  if (idx === -1) return [...fills, replacement];
  return fills.map((f, i) => (i === idx ? { ...replacement, fillOpacity: f.fillOpacity ?? 1 } : f));
}

// Geometry order matters: size and position describe the unrotated box, and
// Penpot rotates around the centre, matching the editor's CSS rotate().
function place(shape: Shape, node: SlideNode, absX: number, absY: number) {
  shape.resize(Math.max(0.01, node.width), Math.max(0.01, node.height));
  shape.x = absX;
  shape.y = absY;
  shape.opacity = node.opacity;
  if (node.rotation) shape.rotation = node.rotation;
}

// Font resolution goes through penpot.fonts so Penpot gets a real fontId and
// variant; setting `fontFamily` alone leaves Penpot guessing.
function applyTextStyle(text: Text, node: SlideNode, warnings: string[]) {
  // Library text style: applying it keeps the link to the typography.
  if (node.typographyId) {
    const lib = findLibrary(node.typographyLibraryId);
    const typography =
      lib?.typographies.find((t) => t.id === node.typographyId) ??
      allLibraries()
        .flatMap((l) => l.typographies)
        .find((t) => t.id === node.typographyId);
    if (typography) {
      text.applyTypography(typography);
      if (node.textAlign) text.align = node.textAlign;
      if (node.verticalAlign) text.verticalAlign = node.verticalAlign;
      if (node.textDecoration) text.textDecoration = node.textDecoration;
      return;
    }
    warnings.push(`Text style for "${node.name}" is no longer in the library — kept its values unlinked.`);
  }

  const font =
    (node.fontId ? penpot.fonts.findById(node.fontId) : null) ??
    (node.fontFamily ? penpot.fonts.findByName(node.fontFamily) : null);

  if (font) {
    const weight = node.fontWeight ?? '400';
    const style = node.fontStyle ?? 'normal';
    const variant =
      font.variants.find((v) => v.fontVariantId === node.fontVariantId) ??
      font.variants.find((v) => v.fontWeight === weight && v.fontStyle === style) ??
      font.variants.find((v) => v.fontWeight === weight) ??
      undefined;
    font.applyToText(text, variant);
  } else if (node.fontFamily && node.fontFamily !== 'sans-serif') {
    warnings.push(`Font "${node.fontFamily}" is not available in this file — Penpot's default font was used.`);
  }

  if (node.fontSize != null) text.fontSize = String(node.fontSize);
  if (node.lineHeight != null) text.lineHeight = String(node.lineHeight);
  if (node.letterSpacing != null) text.letterSpacing = String(node.letterSpacing);
  if (node.textAlign) text.align = node.textAlign;
  if (node.verticalAlign) text.verticalAlign = node.verticalAlign;
  if (node.textTransform) text.textTransform = node.textTransform;
  if (node.textDecoration) text.textDecoration = node.textDecoration;
}

// Full fills/strokes snapshots win; otherwise synthesise a solid fill/stroke
// from the flat fields so nodes created in the plugin still render.
function applyFillsAndStrokes(
  shape: { fills: Fill[] | 'mixed'; strokes: Stroke[] | 'mixed' },
  node: SlideNode,
  defaults: { fill: string }
) {
  if (node.fills && node.fills.length > 0) {
    shape.fills = clonePlain(node.fills) as Fill[];
  } else {
    shape.fills = [
      {
        fillColor: (node.type === 'text' ? node.fontColor : node.fill) ?? defaults.fill,
        fillOpacity: node.fillOpacity ?? 1,
      },
    ];
  }

  if (node.strokes && node.strokes.length > 0) {
    shape.strokes = clonePlain(node.strokes) as Stroke[];
  } else if (node.strokeColor && node.strokeWidth) {
    shape.strokes = [
      {
        strokeStyle: 'solid',
        strokeColor: node.strokeColor,
        strokeOpacity: 1,
        strokeWidth: node.strokeWidth,
        strokeAlignment: 'center',
      },
    ];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(message: PluginMessage) {
  penpot.ui.sendMessage(message);
}

function sendError(message: string) {
  send({ type: 'error', message });
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
