import type { Slide, SlideNode, CopyStateEntry } from '../types';
import type { Board, Fill, ImageData, Shape, Stroke, Text } from '@penpot/plugin-types';
import { allLibraries, findLibrary, findLibraryComponent, applyFillToken } from './libraries';
import { readTextStyle } from './import';
import { hasMedia, readChildren } from './media';
import { clonePlain, base64ToUint8Array, stringifyErr, hashString } from './util';

// ─── Linked template slides ──────────────────────────────────────────────────
// Every node imported from a template remembers its slot (the main
// component's shape id). On a fresh copy each slot is found through
// componentRefShape() and only what differs from the template is written, so
// untouched properties keep following the library.

function refIdOf(shape: Shape): string | null {
  try {
    return shape.componentRefShape()?.id ?? null;
  } catch {
    return null;
  }
}

export function descendants(root: Shape): Shape[] {
  const out: Shape[] = [];
  const visit = (shape: Shape) => {
    for (const child of readChildren(shape)) {
      out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}

const differs = (a: number | undefined, b: number | undefined, tolerance = 0.5) =>
  Math.abs((a ?? 0) - (b ?? 0)) > tolerance;

// Fills compared by what they look like and what they link to, not by object
// shape, so a value read back from Penpot equals the one stored in the deck.
function fillsKey(fills: unknown): string {
  if (!Array.isArray(fills)) return '';
  return fills
    .map((f: Partial<Fill>) =>
      [
        (f.fillColor ?? '').toLowerCase(),
        Math.round((f.fillOpacity ?? 1) * 1000),
        f.fillColorRefId ?? '',
        (f.fillImage as { id?: string } | undefined)?.id ?? '',
        f.fillColorGradient ? JSON.stringify(f.fillColorGradient) : '',
      ].join('|')
    )
    .join(';');
}

function strokesKey(strokes: unknown): string {
  if (!Array.isArray(strokes)) return '';
  return strokes
    .map((s: Partial<Stroke>) =>
      [(s.strokeColor ?? '').toLowerCase(), s.strokeWidth ?? 0, s.strokeOpacity ?? 1, s.strokeStyle ?? '', s.strokeAlignment ?? '', s.strokeColorRefId ?? ''].join('|')
    )
    .join(';');
}

function slideBackgroundFills(slide: Slide): Fill[] {
  return slide.backgroundFills && slide.backgroundFills.length > 0
    ? (clonePlain(slide.backgroundFills) as Fill[])
    : [{ fillColor: slide.background, fillOpacity: 1 }];
}

export async function applySlideToInstance(
  instance: Shape,
  slide: Slide,
  warnings: string[],
  track?: Map<string, string>
): Promise<SlideNode[]> {
  const bySlot = new Map<string, Shape>();
  for (const shape of descendants(instance)) {
    const ref = refIdOf(shape);
    if (ref && !bySlot.has(ref)) bySlot.set(ref, shape);
  }

  const background = slideBackgroundFills(slide);
  if (fillsKey(instance.fills) !== fillsKey(background)) instance.fills = background;

  const kept = new Set<string>([instance.id]);
  const free: SlideNode[] = [];

  const visit = async (nodes: SlideNode[], parentX: number, parentY: number, topLevel: boolean) => {
    for (const node of nodes) {
      const absX = parentX + node.x;
      const absY = parentY + node.y;
      const shape = node.slotId ? bySlot.get(node.slotId) : undefined;
      if (!shape || kept.has(shape.id)) {
        // Not template content (or a second copy of it): a free element, in
        // slide coordinates.
        free.push(topLevel ? node : { ...node, x: absX - instance.x, y: absY - instance.y });
        continue;
      }
      kept.add(shape.id);
      if (topLevel) track?.set(shape.id, node.id);
      try {
        await applyNodeOverrides(shape, node, absX, absY, warnings);
      } catch (err) {
        warnings.push(`"${node.name}": ${stringifyErr(err)}`);
      }
      if (node.type === 'group' && node.children && (shape.type === 'group' || shape.type === 'board')) {
        await visit(node.children, absX, absY, false);
      } else {
        // Leaves of the model (nested components, vectors) own their subtree.
        descendants(shape).forEach((d) => kept.add(d.id));
      }
    }
  };
  await visit(slide.nodes, instance.x, instance.y, true);

  // Template content deleted in the editor is hidden (a copy can't lose
  // children); hiding the topmost removed shape hides its subtree.
  for (const shape of bySlot.values()) {
    if (kept.has(shape.id) || shape.hidden) continue;
    const parentId = shape.parent?.id;
    if (parentId && kept.has(parentId)) shape.hidden = true;
  }
  return free;
}

async function applyNodeOverrides(shape: Shape, node: SlideNode, absX: number, absY: number, warnings: string[]) {
  if (!!shape.hidden !== !node.visible) shape.hidden = !node.visible;
  if (!node.visible) return;
  if (differs(shape.opacity ?? 1, node.opacity, 0.001)) shape.opacity = node.opacity;

  // Geometry (unrotated boxes only: rotated ones are compared by angle).
  if (!shape.rotation && !node.rotation) {
    const text = shape.type === 'text' ? (shape as Text) : null;
    const growType = text?.growType;
    const width = growType === 'auto-width' ? shape.width : node.width;
    const height = growType === 'auto-width' || growType === 'auto-height' ? shape.height : node.height;
    if (differs(shape.width, width) || differs(shape.height, height)) {
      if (node.type === 'component-instance') scaleInstanceTo(shape, width, height);
      else shape.resize(Math.max(0.01, width), Math.max(0.01, height));
      // resize() forces 'fixed'; keep the template's text behaviour.
      if (text && growType && text.growType !== growType) text.growType = growType;
    }
    if (differs(shape.x, absX)) shape.x = absX;
    if (differs(shape.y, absY)) shape.y = absY;
  } else if (differs(shape.rotation, node.rotation, 0.01)) {
    shape.rotation = node.rotation;
  }

  if (shape.type === 'text' && node.type === 'text') {
    const text = shape as Text;
    if (node.text !== undefined && text.characters !== node.text) text.characters = node.text || ' ';
    if (textStyleDiffers(readTextStyle(text), node)) applyTextStyle(text, node, warnings);
    if (node.fills?.length) {
      if (fillsKey(text.fills) !== fillsKey(node.fills)) text.fills = clonePlain(node.fills) as Fill[];
    } else if (node.fontColor && fillsKey(text.fills) !== fillsKey([{ fillColor: node.fontColor, fillOpacity: 1 }])) {
      text.fills = [{ fillColor: node.fontColor, fillOpacity: 1 }];
    }
    applyFillToken(text, node, warnings);
    return;
  }

  if (node.type === 'component-instance') return;

  const current = Array.isArray(shape.fills) ? (shape.fills as Fill[]) : [];
  if (node.imageReplaced) {
    // Vector shapes with an image don't expose it in fills: rebuild from the
    // node's own fill stack.
    const base = node.type === 'path' ? (clonePlain(node.fills ?? []) as Fill[]) : clonePlain(current);
    shape.fills = await withReplacedImage(base, node, warnings);
  } else if (node.type !== 'path' && node.fills && fillsKey(current) !== fillsKey(node.fills)) {
    shape.fills = clonePlain(node.fills) as Fill[];
  }
  if (node.strokes && strokesKey(shape.strokes) !== strokesKey(node.strokes)) {
    shape.strokes = clonePlain(node.strokes) as Stroke[];
  }
  if (shape.type === 'rectangle' && node.borderRadius !== undefined && differs(shape.borderRadius, node.borderRadius, 0.01)) {
    shape.borderRadius = node.borderRadius;
  }
  applyFillToken(shape, node, warnings);
}

function textStyleDiffers(current: Partial<SlideNode>, node: SlideNode): boolean {
  const str = (v: unknown) => (v == null || v === 'none' ? '' : String(v));
  return (
    (!!node.fontId && current.fontId !== node.fontId) ||
    differs(current.fontSize, node.fontSize, 0.01) ||
    (!!node.fontWeight && str(current.fontWeight) !== str(node.fontWeight)) ||
    str(current.fontStyle ?? 'normal') !== str(node.fontStyle ?? 'normal') ||
    differs(current.lineHeight, node.lineHeight ?? current.lineHeight, 0.01) ||
    differs(current.letterSpacing, node.letterSpacing ?? current.letterSpacing, 0.01) ||
    str(current.textAlign ?? 'left') !== str(node.textAlign ?? 'left') ||
    str(current.verticalAlign ?? 'top') !== str(node.verticalAlign ?? 'top') ||
    str(current.textTransform) !== str(node.textTransform) ||
    str(current.textDecoration) !== str(node.textDecoration)
  );
}

// Recursive populator. Nodes are appended in model order (bottom → top):
// Penpot's `appendChild` puts each new shape in front of the previous ones,
// so the stacking order is preserved 1:1.
export async function populateNodes(
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
        applyFillToken(inner, node, warnings);
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
      applyFillToken(text, node, warnings);
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
      applyFillToken(rect, node, warnings);
      place(rect, node, absX, absY);
      return rect;
    }

    case 'ellipse': {
      const ellipse = penpot.createEllipse();
      ellipse.name = node.name;
      parent.appendChild(ellipse);
      applyFillsAndStrokes(ellipse, node, { fill: '#ffffff' });
      if (node.imageReplaced) ellipse.fills = await withReplacedImage(ellipse.fills as Fill[], node, warnings);
      applyFillToken(ellipse, node, warnings);
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
      // applyTypography always leaves line height at 1.2 (Penpot API bug):
      // write the slide's value; the typography link survives it.
      if (node.lineHeight != null && differs(parseFloat(text.lineHeight) || 1.2, node.lineHeight, 0.001)) {
        text.lineHeight = String(node.lineHeight);
      }
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
