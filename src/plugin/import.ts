import type { SlideNode, CopyStateEntry, ImportItemRequest } from '../types';
import type { Library, LibraryTypography, Shape, Text } from '@penpot/plugin-types';
import { safeMarkup, svgDataUrl } from './markup';
import { findLibraryComponent } from './libraries';
import { markScratch } from './jobs';
import { hasMedia, firstMedia, inlineMedia, imageFillDataUrl, safeExportPng, readChildren, readBackground, readFillsSnapshot } from './media';
import { clonePlain, stringifyErr, send } from './util';

// ─── Component Import Pipeline ────────────────────────────────────────────────

export async function handleImportComponents(requestId: string, items: ImportItemRequest[]) {
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
export interface ImportContext {
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
      if (tempInstance) markScratch(tempInstance);
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
export async function importChildren(
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

export async function importShapeSafe(
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
    fillToken: fillTokenOf(shape),
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

function fillTokenOf(shape: Shape): string | undefined {
  try {
    return (shape.tokens as Record<string, string> | undefined)?.fill || undefined;
  } catch {
    return undefined;
  }
}

// Text properties may be 'mixed' when the text has several style runs. In
// that case the first character's style is used instead of hard-coded
// defaults, so at least the dominant opening style survives.
export function readTextStyle(text: Text): Partial<SlideNode> {
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
        // The API often reports no line height for a typography (and never
        // applies it): only compare when it does.
        (t.lineHeight == null || near(style.lineHeight, typographyLineHeight(t))) &&
        near(style.letterSpacing, parseFloat(t.letterSpacing) || 0) &&
        typographyTransform(t) === style.textTransform
    ) ?? null
  );
}

// Library typographies report unset values as null / "none"; texts report
// the effective defaults (1.2 line height, no transform).
export function typographyLineHeight(t: LibraryTypography): number {
  return parseFloat(t.lineHeight) || 1.2;
}

export function typographyTransform(t: LibraryTypography): SlideNode['textTransform'] {
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

