import type {
  UIMessage,
  PluginMessage,
  Slide,
  SlideNode,
  CopyStateEntry,
  ExportSettings,
  ImportItemRequest,
} from './types';
import type { Board, Fill, Shape, Stroke, Text } from '@penpot/plugin-types';

// Open the plugin UI at a comfortable size for a slide builder
penpot.ui.open('Slide Builder', `?theme=${penpot.theme}`, {
  width: 900,
  height: 680,
});

// ─── Message Handler ──────────────────────────────────────────────────────────

penpot.ui.onMessage<UIMessage>((message) => {
  switch (message.type) {
    case 'get-libraries':
      handleGetLibraries();
      break;
    case 'get-components':
      void handleGetComponents(message.requestId, message.libraryId, message.knownThumbnailIds);
      break;
    case 'import-components':
      void handleImportComponents(message.requestId, message.items);
      break;
    case 'insert-into-canvas':
      void handleInsertIntoCanvas(message.slides, message.settings);
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

// ─── Library Handlers ─────────────────────────────────────────────────────────

function allLibraries() {
  return [penpot.library.local, ...penpot.library.connected];
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

function handleGetLibraries() {
  try {
    const local = penpot.library.local;
    const connected = penpot.library.connected;

    // `connected` can also list the file's own library — skip it, it is
    // already represented by `local`.
    const connectedEnabled = connected.filter(
      (lib) => lib.id !== local.id && lib.components.length > 0
    );

    const libraries = [
      {
        id: local.id,
        name: `${local.name} (Local)`,
        numComponents: local.components.length,
      },
      ...connectedEnabled.map((lib) => ({
        id: lib.id,
        name: lib.name,
        numComponents: lib.components.length,
      })),
    ].filter((lib) => lib.numComponents > 0);

    send({ type: 'libraries', libraries });
  } catch (err) {
    sendError('Failed to load libraries: ' + stringifyErr(err));
  }
}

// Thumbnails go through Penpot's exporter, which is server-side and slow
// (seconds per component), so the job is cancellable: a newer request for any
// library supersedes the running one.
const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_CONCURRENCY = 3;
let activeThumbnailRequest: string | null = null;

async function handleGetComponents(requestId: string, libraryId: string, knownThumbnailIds: string[]) {
  activeThumbnailRequest = requestId;
  try {
    const lib = allLibraries().find((l) => l.id === libraryId);
    if (!lib) {
      sendError(`Library not found: ${libraryId}`);
      return;
    }

    const components = lib.components.map((comp) => {
      let width: number | undefined;
      let height: number | undefined;
      try {
        const main = comp.mainInstance();
        if (main) {
          width = main.width;
          height = main.height;
        }
      } catch {
        // The main instance may be unavailable (e.g. not loaded yet); the
        // card simply shows no size.
      }
      return { id: comp.id, libraryId, name: comp.name, path: comp.path ?? '', width, height };
    });

    // Send the list immediately so the grid renders without waiting.
    send({ type: 'components', requestId, libraryId, components });

    const known = new Set(knownThumbnailIds);
    const queue = lib.components.filter((c) => !known.has(c.id));
    const worker = async () => {
      while (queue.length > 0 && activeThumbnailRequest === requestId) {
        const comp = queue.shift()!;
        try {
          const main = comp.mainInstance();
          if (!main) continue;
          const scale = Math.min(1, THUMBNAIL_WIDTH / Math.max(1, main.width));
          const bytes = await main.export({ type: 'png', scale });
          if (activeThumbnailRequest !== requestId) return;
          send({
            type: 'thumbnail',
            requestId,
            componentId: comp.id,
            thumbnail: `data:image/png;base64,${uint8ArrayToBase64(bytes)}`,
          });
        } catch {
          // No thumbnail for this component — the card falls back to a
          // placeholder once `thumbnails-complete` arrives.
        }
      }
    };
    await Promise.all(Array.from({ length: THUMBNAIL_CONCURRENCY }, worker));

    if (activeThumbnailRequest === requestId) {
      send({ type: 'thumbnails-complete', requestId });
    }
  } catch (err) {
    sendError('Failed to load components: ' + stringifyErr(err));
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
      send({
        type: 'import-item',
        requestId,
        componentId: item.componentId,
        libraryId: item.libraryId,
        componentName: item.componentName,
        nodes: result.nodes,
        background: result.background,
        backgroundFills: result.backgroundFills,
        width: result.width,
        height: result.height,
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
}

// Import a component by reading its main instance (cheap, read-only) or, if
// that fails, a temporary off-canvas instance that is removed afterwards. As
// a last resort the whole component becomes a single image node.
async function importSingleComponent(item: ImportItemRequest): Promise<ImportResult> {
  const found = findLibraryComponent(item.libraryId, item.componentId);
  if (!found) {
    throw new Error(`Component "${item.componentName}" not found in any available library.`);
  }
  const { comp } = found;
  const errors: string[] = [];

  let main: Shape | null = null;
  try {
    main = comp.mainInstance() ?? null;
  } catch (err) {
    errors.push(`mainInstance(): ${stringifyErr(err)}`);
  }

  if (main) {
    try {
      return await buildResultFromRoot(main, item);
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
        return await buildResultFromRoot(tempInstance, item);
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

async function buildResultFromRoot(root: Shape, item: ImportItemRequest): Promise<ImportResult> {
  const ctx: ImportContext = { rootComponentId: item.componentId, warnings: [] };
  const width = root.width ?? item.width ?? 1280;
  const height = root.height ?? item.height ?? 720;
  const background = readBackground(root) ?? '#18181a';
  const backgroundFills = readFillsSnapshot(root);
  const nodes = await importRootShape(root, ctx);
  return { nodes, background, backgroundFills, width, height, warnings: ctx.warnings };
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
  };

  const fills = 'fills' in shape && Array.isArray(shape.fills) ? shape.fills : [];
  const firstFill = fills[0];
  const fillColor = firstFill?.fillColor;
  const fillOpacity = firstFill?.fillOpacity ?? 1;
  const fillsSnapshot = fills.length > 0 ? clonePlain(fills) : undefined;

  const strokes = 'strokes' in shape && Array.isArray(shape.strokes) ? shape.strokes : [];
  const firstStroke = strokes[0];
  const strokesSnapshot = strokes.length > 0 ? clonePlain(strokes) : undefined;

  // Nested component instance (e.g. a logo inside the template): keep it as
  // a link so export re-instantiates the real component.
  const componentRef = detectNestedInstance(shape, ctx.rootComponentId);
  if (componentRef) {
    const svgMarkup = safeMarkup(shape);
    return {
      ...base,
      type: 'component-instance',
      libraryId: componentRef.libraryId,
      componentId: componentRef.componentId,
      componentName: componentRef.name,
      copyState: captureCopyState(shape),
      svgMarkup,
      imageUrl: svgMarkup ? svgDataUrl(svgMarkup) : await safeExportPng(shape, 0.5),
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
      fill: fillColor,
      fillOpacity,
      fills: fillsSnapshot,
      strokes: strokesSnapshot,
      children: await importChildren(readChildren(shape), absX, absY, ctx),
    };
  }

  if (shape.type === 'text') {
    return { ...base, type: 'text', ...readTextStyle(shape), fills: fillsSnapshot, strokes: strokesSnapshot };
  }

  if (shape.type === 'ellipse') {
    return {
      ...base,
      type: 'ellipse',
      fill: fillColor ?? '#6457f0',
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
      fill: fillColor ?? '#6457f0',
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
  if (svgMarkup && svgMarkup.includes('by-file-media-id')) svgMarkup = undefined;
  // The markup already bakes the rotation in, so describe these nodes by
  // their rotated bounding box with rotation 0 — otherwise they would be
  // rotated twice (editor and export).
  const bakedGeometry =
    svgMarkup && rotation
      ? {
          x: shape.bounds.x - parentX,
          y: shape.bounds.y - parentY,
          width: shape.bounds.width,
          height: shape.bounds.height,
          rotation: 0,
        }
      : {};
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
    return svg && svg.includes('<svg') ? svg : undefined;
  } catch {
    return undefined;
  }
}

// Percent-encoding instead of base64: no TextEncoder needed in the sandbox.
function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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

async function handleInsertIntoCanvas(slides: Slide[], settings: ExportSettings) {
  const warnings: string[] = [];
  try {
    if (slides.length === 0) {
      send({ type: 'insert-complete', count: 0, warnings });
      return;
    }

    if (settings.createNewPage) {
      const page = penpot.createPage();
      page.name = settings.slidePrefix ? `${settings.slidePrefix}s` : 'Slides';
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

async function populateSlide(board: Board, slide: Slide, warnings: string[]) {
  // Library slide without extracted nodes: drop in a linked instance.
  if (slide.source === 'library-component' && slide.nodes.length === 0) {
    const found = findLibraryComponent(slide.libraryId, slide.componentId);
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
  await populateNodes(board, slide.nodes, board.x, board.y, warnings);
}

// Recursive populator. Nodes are appended in model order (bottom → top):
// Penpot's `appendChild` puts each new shape in front of the previous ones,
// so the stacking order is preserved 1:1.
async function populateNodes(
  parent: Board,
  nodes: SlideNode[],
  offsetX: number,
  offsetY: number,
  warnings: string[]
): Promise<Shape[]> {
  const created: Shape[] = [];
  for (const node of nodes) {
    if (!node.visible) continue;
    try {
      const shape = await createShapeForNode(parent, node, offsetX + node.x, offsetY + node.y, warnings);
      if (shape) created.push(shape);
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
      if (node.borderRadius) rect.borderRadius = node.borderRadius;
      place(rect, node, absX, absY);
      return rect;
    }

    case 'ellipse': {
      const ellipse = penpot.createEllipse();
      ellipse.name = node.name;
      parent.appendChild(ellipse);
      applyFillsAndStrokes(ellipse, node, { fill: '#ffffff' });
      place(ellipse, node, absX, absY);
      return ellipse;
    }

    case 'component-instance': {
      const found = findLibraryComponent(node.libraryId, node.componentId);
      if (found) {
        const instance = found.comp.instance();
        instance.name = node.name;
        parent.appendChild(instance);
        place(instance, node, absX, absY);
        if (node.copyState) replayCopyState(instance, node.copyState, node.name, warnings);
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

// Vectors are rebuilt from their SVG source; raster-only nodes become a
// rectangle with an image fill (uploaded from the snapshot if needed).
async function createVectorOrImage(
  parent: Board,
  node: SlideNode,
  absX: number,
  absY: number,
  warnings: string[]
): Promise<Shape | null> {
  if (node.svgMarkup) {
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
  if (hasImageFill) {
    rect.fills = clonePlain(node.fills) as Fill[];
  } else if (node.imageUrl) {
    const match = /^data:([^;]+);base64,(.*)$/.exec(node.imageUrl);
    if (match) {
      const image = await penpot.uploadMediaData(node.name, base64ToUint8Array(match[2]), match[1]);
      rect.fills = [{ fillOpacity: 1, fillImage: image }];
    }
  } else {
    warnings.push(`"${node.name}" has no visual source — inserted an empty placeholder.`);
    rect.fills = [];
  }
  if (node.strokes?.length) rect.strokes = clonePlain(node.strokes) as Stroke[];
  place(rect, node, absX, absY);
  return rect;
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
