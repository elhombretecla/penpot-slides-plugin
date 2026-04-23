import type {
  UIMessage,
  PluginMessage,
  Slide,
  SlideNode,
  ExportSettings,
  ImportItemRequest,
} from './types';
import type { Fill, Stroke } from '@penpot/plugin-types';

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
      handleGetComponents(message.libraryId);
      break;
    case 'import-components':
      handleImportComponents(message.requestId, message.items);
      break;
    case 'insert-into-canvas':
      handleInsertIntoCanvas(message.slides, message.settings);
      break;
    case 'resize':
      penpot.ui.resize(message.width, message.height);
      break;
  }
});

// ─── Theme Change ─────────────────────────────────────────────────────────────

penpot.on('themechange', (theme) => {
  const msg: PluginMessage = { type: 'theme', theme };
  penpot.ui.sendMessage(msg);
});

// ─── Library Handlers ─────────────────────────────────────────────────────────

function handleGetLibraries() {
  try {
    const local = penpot.library.local;
    const connected = penpot.library.connected;

    // Only include connected libraries that are actually enabled in the file's
    // Assets panel — those will have their components accessible (length > 0).
    // Also deduplicate: skip any entry whose id matches the local library.
    const connectedEnabled = connected.filter(
      (lib) => lib.id !== local.id && lib.components.length > 0
    );

    const allLibraries = [
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
    ];

    // Only surface libraries that have at least one component to use as a template.
    const libraries = allLibraries.filter((lib) => lib.numComponents > 0);

    const msg: PluginMessage = { type: 'libraries', libraries };
    penpot.ui.sendMessage(msg);
  } catch (err) {
    sendError('Failed to load libraries: ' + String(err));
  }
}

async function handleGetComponents(libraryId: string) {
  try {
    const allLibs = [penpot.library.local, ...penpot.library.connected];
    const lib = allLibs.find((l) => l.id === libraryId);

    if (!lib) {
      sendError(`Library not found: ${libraryId}`);
      return;
    }

    // Collect base info synchronously and send immediately so the UI can render
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
        // mainInstance may not be available in all contexts
      }
      return {
        id: comp.id,
        libraryId,
        name: comp.name,
        path: comp.path ?? '',
        width,
        height,
      };
    });

    // Send component list immediately — UI shows grid without waiting for thumbnails
    const msg: PluginMessage = { type: 'components', libraryId, components };
    penpot.ui.sendMessage(msg);

    // Export thumbnails one by one (sequential avoids overwhelming the runtime)
    // and stream each result as it completes
    for (const comp of lib.components) {
      try {
        const main = comp.mainInstance();
        if (!main) continue;
        const bytes = await main.export({ type: 'png', scale: 0.2 });
        const thumbnail = `data:image/png;base64,${uint8ArrayToBase64(bytes)}`;
        const thumbMsg: PluginMessage = { type: 'thumbnail', componentId: comp.id, thumbnail };
        penpot.ui.sendMessage(thumbMsg);
      } catch {
        // Skip components whose main instance can't be exported
      }
    }

    // Signal that all thumbnail exports are done (clears pending spinners)
    const doneMsg: PluginMessage = { type: 'thumbnails-complete' };
    penpot.ui.sendMessage(doneMsg);
  } catch (err) {
    sendError('Failed to load components: ' + String(err));
  }
}

// Plain deep-clone helper for serialisable payloads (fills, strokes, etc.).
// Used so the snapshots we send to the UI are independent of the live Penpot
// shape and survive the postMessage structured-clone hop.
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
    const chunk = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

// ─── Component Import Pipeline ────────────────────────────────────────────────

type AnyShape = ReturnType<typeof penpot.createBoard>['children'][number];

async function handleImportComponents(requestId: string, items: ImportItemRequest[]) {
  const startMsg: PluginMessage = {
    type: 'import-start',
    requestId,
    total: items.length,
  };
  penpot.ui.sendMessage(startMsg);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    const progressMsg: PluginMessage = {
      type: 'import-progress',
      requestId,
      index: i,
      total: items.length,
      componentId: item.componentId,
      componentName: item.componentName,
    };
    penpot.ui.sendMessage(progressMsg);

    try {
      const result = await importSingleComponent(item);

      const itemMsg: PluginMessage = {
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
      };
      penpot.ui.sendMessage(itemMsg);
      success++;
    } catch (err) {
      failed++;
      const errMsg: PluginMessage = {
        type: 'import-item-error',
        requestId,
        componentId: item.componentId,
        componentName: item.componentName,
        message: stringifyErr(err),
      };
      penpot.ui.sendMessage(errMsg);
    }
  }

  const completeMsg: PluginMessage = {
    type: 'import-complete',
    requestId,
    success,
    failed,
  };
  penpot.ui.sendMessage(completeMsg);
}

interface ImportResult {
  nodes: SlideNode[];
  background: string;
  backgroundFills?: unknown[];
  width: number;
  height: number;
}

// Import a single component by reading its main instance (cheap) or, if that
// fails, by creating a temporary off-canvas instance and cleaning it up. As a
// last resort, fall back to a single full-size image node using the component
// PNG export so the user always has something to work with.
async function importSingleComponent(item: ImportItemRequest): Promise<ImportResult> {
  const allLibs = [penpot.library.local, ...penpot.library.connected];
  const lib = allLibs.find((l) => l.id === item.libraryId);
  if (!lib) {
    throw new Error(`Library not found (id ${item.libraryId}).`);
  }
  const comp = lib.components.find((c) => c.id === item.componentId);
  if (!comp) {
    throw new Error(`Component not found inside "${lib.name}".`);
  }

  const errors: string[] = [];

  // 1. Try mainInstance first — cheapest and does not mutate the document.
  let main: AnyShape | null = null;
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

  // 2. Fallback: create a temporary instance far off-canvas, read, remove.
  let tempInstance: AnyShape | null = null;
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
      } catch {
        // Leave it off-canvas if we cannot clean up.
      }
    }
  }

  // 3. Last-resort fallback: export the main instance (or a temp instance) as
  //    a single PNG so the user can at least see the component inside the
  //    plugin. Keeps position/size; children become non-editable.
  const snapshotRoot = main;
  if (snapshotRoot) {
    const imageUrl = await safeExportPng(snapshotRoot, 1);
    if (imageUrl) {
      const width = snapshotRoot.width ?? item.width ?? 1280;
      const height = snapshotRoot.height ?? item.height ?? 720;
      const background = readBackground(snapshotRoot) ?? '#18181a';
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
        background,
        width,
        height,
      };
    }
  }

  throw new Error(
    errors.length > 0
      ? errors.join(' · ')
      : 'Component could not be read from the library.'
  );
}

async function buildResultFromRoot(
  root: AnyShape,
  item: ImportItemRequest
): Promise<ImportResult> {
  const width = root.width ?? item.width ?? 1280;
  const height = root.height ?? item.height ?? 720;
  const background = readBackground(root) ?? '#18181a';
  const backgroundFills = readFillsSnapshot(root);
  const nodes = await importRootShape(root);
  return { nodes, background, backgroundFills, width, height };
}

// Read the content of a component root. If the root is a container (board /
// group / boolean) with children, iterate them relative to the root origin.
// If the root is a single shape (e.g. a text-only component) or has no
// children, import the root itself as a single top-level leaf at (0,0).
async function importRootShape(root: AnyShape): Promise<SlideNode[]> {
  const rootX = root.x ?? 0;
  const rootY = root.y ?? 0;
  const children = readChildren(root);

  if (children.length > 0) {
    const out: SlideNode[] = [];
    for (const child of children) {
      try {
        const node = await importShape(child, rootX, rootY);
        if (node) out.push(node);
      } catch {
        // Skip children that fail to convert
      }
    }
    return out;
  }

  try {
    const node = await importShape(root, rootX, rootY);
    if (!node) return [];
    // Force the single-leaf root to (0,0) in slide coordinates.
    return [{ ...node, x: 0, y: 0 }];
  } catch {
    return [];
  }
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message || err.toString();
  try {
    return typeof err === 'string' ? err : JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// Recursive importer: converts a Penpot shape (possibly containing other shapes)
// into a SlideNode tree. Coordinates are stored relative to `parentX`/`parentY`
// so groups keep their children logically nested.
async function importShape(
  shape: AnyShape,
  parentX: number,
  parentY: number
): Promise<SlideNode | null> {
  const absX = shape.x ?? 0;
  const absY = shape.y ?? 0;
  const width = shape.width ?? 0;
  const height = shape.height ?? 0;

  const base = {
    id: shape.id,
    name: shape.name ?? 'Element',
    x: absX - parentX,
    y: absY - parentY,
    width,
    height,
    visible: !shape.hidden,
    opacity: shape.opacity ?? 1,
    rotation: shape.rotation ?? 0,
    sourceType: shape.type,
  };

  const fills = 'fills' in shape && Array.isArray(shape.fills) ? shape.fills : [];
  const firstFill = fills[0];
  const fillColor = firstFill?.fillColor;
  const fillOpacity = firstFill?.fillOpacity ?? 1;
  // Deep-clone the full array so gradients / image fills / multi-fills survive
  // the postMessage round-trip and are decoupled from the live Penpot shape.
  const fillsSnapshot = fills.length > 0 ? clonePlain(fills) : undefined;

  const strokes = 'strokes' in shape && Array.isArray(shape.strokes) ? shape.strokes : [];
  const firstStroke = strokes[0];
  const strokeColor = firstStroke?.strokeColor;
  const strokeWidth = firstStroke?.strokeWidth;
  const strokesSnapshot = strokes.length > 0 ? clonePlain(strokes) : undefined;

  // A component instance is typically a board that exposes a `component` ref.
  // We treat it as a single editable block, keeping the link metadata so the
  // user can re-apply it during export.
  const componentRef = detectComponentInstance(shape);
  if (componentRef) {
    const imageUrl = await safeExportPng(shape, 0.5);
    return {
      ...base,
      type: 'component-instance',
      libraryId: componentRef.libraryId,
      componentId: componentRef.componentId,
      componentName: componentRef.name,
      imageUrl,
    };
  }

  // Groups / boolean operations — keep the hierarchy so users can edit children.
  if (shape.type === 'group' || shape.type === 'boolean') {
    const children = readChildren(shape);
    const nestedNodes: SlideNode[] = [];
    for (const c of children) {
      try {
        const n = await importShape(c, absX, absY);
        if (n) nestedNodes.push(n);
      } catch {
        // skip child
      }
    }
    return {
      ...base,
      type: 'group',
      children: nestedNodes,
    };
  }

  // Nested boards keep hierarchy but also carry a background fill.
  if (shape.type === 'board') {
    const children = readChildren(shape);
    const nestedNodes: SlideNode[] = [];
    for (const c of children) {
      try {
        const n = await importShape(c, absX, absY);
        if (n) nestedNodes.push(n);
      } catch {
        // skip child
      }
    }
    return {
      ...base,
      type: 'group',
      clipContent: true,
      fill: fillColor,
      fillOpacity,
      fills: fillsSnapshot,
      children: nestedNodes,
    };
  }

  if (shape.type === 'text') {
    const textAlign =
      shape.align !== 'mixed' && shape.align !== 'justify' && shape.align
        ? (shape.align as 'left' | 'center' | 'right')
        : 'left';

    return {
      ...base,
      type: 'text',
      text: shape.characters ?? '',
      fontSize: shape.fontSize !== 'mixed' ? parseFloat(String(shape.fontSize)) || 16 : 16,
      fontWeight: shape.fontWeight !== 'mixed' ? String(shape.fontWeight) : '400',
      fontFamily: shape.fontFamily !== 'mixed' ? String(shape.fontFamily) : 'sans-serif',
      fontColor: firstFill?.fillColor ?? '#ffffff',
      textAlign,
      lineHeight:
        shape.lineHeight !== 'mixed' ? parseFloat(String(shape.lineHeight)) || 1.4 : 1.4,
      letterSpacing:
        shape.letterSpacing !== 'mixed' ? parseFloat(String(shape.letterSpacing)) || 0 : 0,
      fills: fillsSnapshot,
      strokes: strokesSnapshot,
    };
  }

  if (shape.type === 'ellipse') {
    return {
      ...base,
      type: 'ellipse',
      fill: fillColor ?? '#6457f0',
      fillOpacity,
      strokeColor,
      strokeWidth,
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
      strokeColor,
      strokeWidth,
      borderRadius: ('borderRadius' in shape ? (shape.borderRadius as number) : 0) ?? 0,
      fills: fillsSnapshot,
      strokes: strokesSnapshot,
    };
  }

  if (shape.type === 'image') {
    const imageUrl = await safeExportPng(shape, 1);
    return {
      ...base,
      type: 'image',
      imageUrl,
      fill: fillColor,
      fillOpacity,
      fills: fillsSnapshot,
      strokes: strokesSnapshot,
    };
  }

  if (shape.type === 'path' || shape.type === 'svg-raw') {
    const imageUrl = await safeExportPng(shape, 1);
    return {
      ...base,
      type: 'path',
      imageUrl,
      fill: fillColor,
      fillOpacity,
      strokeColor,
      strokeWidth,
      fills: fillsSnapshot,
      strokes: strokesSnapshot,
    };
  }

  // Unknown shape type — take a visual snapshot so nothing silently disappears.
  const imageUrl = await safeExportPng(shape, 1);
  return {
    ...base,
    type: 'path',
    imageUrl,
    fill: fillColor,
    fillOpacity,
    fills: fillsSnapshot,
    strokes: strokesSnapshot,
  };
}

function detectComponentInstance(
  shape: AnyShape
): { libraryId?: string; componentId?: string; name?: string } | null {
  try {
    const anyShape = shape as unknown as {
      component?: { libraryId?: string; id?: string; name?: string };
      mainComponent?: { libraryId?: string; id?: string; name?: string };
      isComponentInstance?: boolean;
      componentId?: string;
      libraryId?: string;
      componentRefId?: string;
    };
    const linked = anyShape.component ?? anyShape.mainComponent;
    if (linked && (linked.id || linked.libraryId)) {
      return {
        libraryId: linked.libraryId,
        componentId: linked.id,
        name: linked.name ?? safeName(shape),
      };
    }
    if (anyShape.isComponentInstance && anyShape.componentId) {
      return {
        libraryId: anyShape.libraryId,
        componentId: anyShape.componentId,
        name: safeName(shape),
      };
    }
  } catch {
    // Some Penpot shapes expose these as getters that throw when not
    // "mounted" (e.g. on library main instances). Treat as not-an-instance.
  }
  return null;
}

function safeName(shape: AnyShape): string | undefined {
  try {
    return shape.name ?? undefined;
  } catch {
    return undefined;
  }
}

async function safeExportPng(shape: AnyShape, scale: number): Promise<string | undefined> {
  try {
    if (!('export' in shape) || typeof (shape as { export?: unknown }).export !== 'function') {
      return undefined;
    }
    const bytes = await (
      shape as unknown as {
        export: (opts: { type: 'png'; scale: number }) => Promise<Uint8Array>;
      }
    ).export({ type: 'png', scale });
    return `data:image/png;base64,${uint8ArrayToBase64(bytes)}`;
  } catch {
    return undefined;
  }
}

function readChildren(shape: unknown): AnyShape[] {
  if (!shape || typeof shape !== 'object') return [];
  try {
    const c = (shape as { children?: unknown }).children;
    if (!c) return [];
    if (Array.isArray(c)) return c as AnyShape[];
    // Some implementations expose `children` as an iterable / live list.
    try {
      return Array.from(c as Iterable<AnyShape>);
    } catch {
      return [];
    }
  } catch {
    // Accessing `.children` may throw on certain shapes; treat as no children.
    return [];
  }
}

function readBackground(shape: unknown): string | null {
  if (!shape || typeof shape !== 'object') return null;
  try {
    const fills = (shape as { fills?: unknown }).fills;
    if (Array.isArray(fills) && fills.length > 0) {
      const fill = fills[0] as { fillColor?: string };
      if (fill && typeof fill.fillColor === 'string') return fill.fillColor;
    }
  } catch {
    // ignore
  }
  return null;
}

function readFillsSnapshot(shape: unknown): unknown[] | undefined {
  if (!shape || typeof shape !== 'object') return undefined;
  try {
    const fills = (shape as { fills?: unknown }).fills;
    if (Array.isArray(fills) && fills.length > 0) {
      return clonePlain(fills);
    }
  } catch {
    // ignore
  }
  return undefined;
}

// ─── Canvas Insertion ─────────────────────────────────────────────────────────

function handleInsertIntoCanvas(slides: Slide[], settings: ExportSettings) {
  try {
    let xOffset = penpot.viewport.center.x - (slides.length * (slides[0]?.width ?? 1280)) / 2;
    const yBase = penpot.viewport.center.y - (slides[0]?.height ?? 720) / 2;

    const insertedBoards: ReturnType<typeof penpot.createBoard>[] = [];

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const slideName = `${settings.slidePrefix} ${String(i + 1).padStart(2, '0')}`;

      if (
        slide.source === 'library-component' &&
        slide.libraryId &&
        slide.componentId &&
        slide.nodes.length === 0
      ) {
        // Library-linked slide without imported nodes: insert as a component instance
        const board = createBoardForSlide(slide, xOffset, yBase, slideName);
        try {
          const allLibs = [penpot.library.local, ...penpot.library.connected];
          const lib = allLibs.find((l) => l.id === slide.libraryId);
          const comp = lib?.components.find((c) => c.id === slide.componentId);
          if (comp) {
            const instance = comp.instance();
            // Penpot shape coordinates are absolute in the canvas, so we
            // position the instance at the board's absolute origin.
            instance.x = board.x;
            instance.y = board.y;
            board.appendChild(instance);
          }
        } catch {
          // If component instantiation fails, leave the board empty
        }
        insertedBoards.push(board);
      } else {
        const board = createBoardForSlide(slide, xOffset, yBase, slideName);
        // SlideNode coordinates are relative to the slide origin; Penpot shape
        // coordinates are absolute in the canvas — offset by the board's
        // absolute position so children land inside the board.
        populateBoardWithNodes(board, slide.nodes, board.x, board.y);
        insertedBoards.push(board);
      }

      xOffset += slide.width + settings.spacing;
    }

    if (settings.groupIntoSection && insertedBoards.length > 0) {
      try {
        penpot.selection = insertedBoards;
      } catch {
        // Selection may not be available in all contexts
      }
    }

    const msg: PluginMessage = { type: 'insert-complete', count: insertedBoards.length };
    penpot.ui.sendMessage(msg);
  } catch (err) {
    sendError('Failed to insert slides: ' + String(err));
  }
}

function createBoardForSlide(
  slide: Slide,
  x: number,
  y: number,
  name: string
): ReturnType<typeof penpot.createBoard> {
  const board = penpot.createBoard();
  board.name = name;
  board.x = x;
  board.y = y;
  board.resize(slide.width, slide.height);
  board.clipContent = true;

  // Prefer the full fills snapshot captured at import time — keeps gradients,
  // image fills, multi-fill stacks and per-fill opacities. Fall back to the
  // flat hex background for slides created from scratch in the plugin.
  if (slide.backgroundFills && slide.backgroundFills.length > 0) {
    board.fills = clonePlain(slide.backgroundFills) as Fill[];
  } else {
    board.fills = [
      {
        fillColor: slide.background,
        fillOpacity: 1,
      },
    ];
  }

  return board;
}

// Apply the full fills/strokes snapshots when available; otherwise synthesise
// a single solid fill / stroke from the flat convenience fields so nodes
// created from scratch in the plugin UI still render correctly.
// `text.fills` can be `'mixed'` in the getter but accepts a `Fill[]` on write,
// so the parameter type widens to accommodate both rect/ellipse and text.
function applyFillsAndStrokes(
  shape: {
    fills: Fill[] | 'mixed';
    strokes: Stroke[] | 'mixed';
  },
  node: SlideNode,
  defaults: { fill: string; fillOpacity?: number }
) {
  if (node.fills && node.fills.length > 0) {
    shape.fills = clonePlain(node.fills) as Fill[];
  } else {
    shape.fills = [
      {
        fillColor: node.fill ?? defaults.fill,
        fillOpacity: node.fillOpacity ?? defaults.fillOpacity ?? 1,
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

// Recursive board populator. Group nodes accumulate their offset so children
// land at the correct absolute slide coordinates.
//
// Iteration order: `slide.nodes[0]` is the top of the visual stack in our
// model (matches how `SlideCanvas` renders via `.map()` where later DOM
// siblings paint on top). Penpot stacks children such that calling
// `board.appendChild` for each node in natural order results in the first
// array element ending up BEHIND the others. Iterating in reverse so the
// top-of-stack node is appended last keeps it visually on top in Penpot.
function populateBoardWithNodes(
  board: ReturnType<typeof penpot.createBoard>,
  nodes: SlideNode[],
  offsetX: number,
  offsetY: number
) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (!node.visible) continue;

    const absX = offsetX + node.x;
    const absY = offsetY + node.y;

    try {
      if (node.type === 'group') {
        populateBoardWithNodes(board, node.children ?? [], absX, absY);
        continue;
      }

      if (node.type === 'text') {
        const text = penpot.createText(node.text ?? '');
        if (text) {
          text.name = node.name;
          // Fixed growth so resize() honours the slide layout instead of
          // auto-fitting to the characters.
          text.growType = 'fixed';
          text.x = absX;
          text.y = absY;
          text.resize(node.width, node.height);
          text.opacity = node.opacity;
          text.rotation = node.rotation;

          if (node.fontFamily) text.fontFamily = node.fontFamily;
          if (node.fontSize != null) text.fontSize = String(node.fontSize);
          if (node.fontWeight) text.fontWeight = node.fontWeight;
          if (node.lineHeight != null) text.lineHeight = String(node.lineHeight);
          if (node.letterSpacing != null) text.letterSpacing = String(node.letterSpacing);
          if (node.textAlign) text.align = node.textAlign;

          applyFillsAndStrokes(text, node, {
            fill: node.fontColor ?? '#ffffff',
          });

          board.appendChild(text);
        }
        continue;
      }

      if (node.type === 'rect' || node.type === 'image' || node.type === 'path') {
        const rect = penpot.createRectangle();
        rect.name = node.name;
        rect.x = absX;
        rect.y = absY;
        rect.resize(node.width, node.height);
        rect.opacity = node.opacity;
        rect.rotation = node.rotation;

        applyFillsAndStrokes(rect, node, { fill: '#d0d0d0' });

        if (node.borderRadius) {
          rect.borderRadius = node.borderRadius;
        }

        board.appendChild(rect);
        continue;
      }

      if (node.type === 'ellipse') {
        const ellipse = penpot.createEllipse();
        ellipse.name = node.name;
        ellipse.x = absX;
        ellipse.y = absY;
        ellipse.resize(node.width, node.height);
        ellipse.opacity = node.opacity;
        ellipse.rotation = node.rotation;

        applyFillsAndStrokes(ellipse, node, { fill: '#ffffff' });

        board.appendChild(ellipse);
        continue;
      }

      if (node.type === 'component-instance') {
        const allLibs = [penpot.library.local, ...penpot.library.connected];
        const lib = allLibs.find((l) => l.id === node.libraryId);
        const comp = lib?.components.find((c) => c.id === node.componentId);
        if (comp) {
          const instance = comp.instance();
          instance.name = node.name;
          instance.x = absX;
          instance.y = absY;
          instance.resize(node.width, node.height);
          board.appendChild(instance);
        }
        continue;
      }
    } catch {
      // Skip nodes that fail to create
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendError(message: string) {
  const msg: PluginMessage = { type: 'error', message };
  penpot.ui.sendMessage(msg);
}
