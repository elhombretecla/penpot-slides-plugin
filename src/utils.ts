import { v4 as uuidv4 } from 'uuid';
import type { ComponentInfo, Slide, SlideNode, PresetLayout, SlideSizePreset } from './types';
import { SLIDE_SIZE_PRESETS } from './types';

// ─── Slide Creation Helpers ───────────────────────────────────────────────────

export function createEmptySlide(
  name: string,
  sizePreset: SlideSizePreset,
  background: string,
  customW?: number,
  customH?: number
): Slide {
  const size =
    sizePreset === 'custom'
      ? { width: customW ?? 800, height: customH ?? 600 }
      : SLIDE_SIZE_PRESETS[sizePreset];

  return {
    id: uuidv4(),
    name,
    source: 'custom',
    width: size.width,
    height: size.height,
    background,
    nodes: [],
  };
}

export function createSlideWithLayout(
  name: string,
  sizePreset: SlideSizePreset,
  background: string,
  layout: PresetLayout,
  customW?: number,
  customH?: number
): Slide {
  const slide = createEmptySlide(name, sizePreset, background, customW, customH);
  const { width: w, height: h } = slide;

  const nodes: SlideNode[] = [];

  switch (layout) {
    case 'title-only':
      nodes.push(makeTitleNode('Title', w * 0.1, h * 0.35, w * 0.8, h * 0.2, w));
      break;

    case 'title-text':
      nodes.push(makeTitleNode('Slide Title', w * 0.1, h * 0.15, w * 0.8, h * 0.18, w));
      nodes.push(makeBodyNode(
        'Body Text',
        'Add your content here. Click to edit this text.',
        w * 0.1, h * 0.4, w * 0.8, h * 0.45, w
      ));
      break;

    case 'two-columns': {
      const colW = w * 0.42;
      nodes.push(makeTitleNode('Slide Title', w * 0.05, h * 0.06, w * 0.9, h * 0.15, w));
      nodes.push(makeBodyNode('Left Column', 'Left column content', w * 0.05, h * 0.28, colW, h * 0.58, w));
      nodes.push(makeBodyNode('Right Column', 'Right column content', w * 0.53, h * 0.28, colW, h * 0.58, w));
      break;
    }

    case 'image-caption': {
      nodes.push(makeRectNode('Image Placeholder', w * 0.05, h * 0.08, w * 0.9, h * 0.6, '#2d2d4e'));
      nodes.push(makeBodyNode('Caption', 'Image caption or description', w * 0.05, h * 0.72, w * 0.9, h * 0.2, w));
      break;
    }

    case 'empty':
    default:
      break;
  }

  return { ...slide, nodes };
}

// ─── Node Factories ───────────────────────────────────────────────────────────

export function makeTitleNode(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  slideWidth: number
): SlideNode {
  return {
    id: uuidv4(),
    type: 'text',
    name,
    x, y, width, height,
    visible: true,
    opacity: 1,
    rotation: 0,
    text: name,
    fontSize: Math.max(24, Math.round(slideWidth * 0.04)),
    fontWeight: '700',
    fontColor: '#ffffff',
    textAlign: 'center',
    fontFamily: 'Work Sans',
    fontId: 'gfont-work-sans',
    lineHeight: 1.1,
    role: 'title',
  };
}

// Body copy that reads well on a projected slide: ~2.2% of the slide width
// (42 px on 1920).
function bodySize(slideWidth: number) {
  return Math.max(16, Math.round(slideWidth * 0.022));
}

export function makeBodyNode(
  name: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  slideWidth = 1920
): SlideNode {
  return {
    id: uuidv4(),
    type: 'text',
    name,
    x, y, width, height,
    visible: true,
    opacity: 1,
    rotation: 0,
    text,
    fontSize: bodySize(slideWidth),
    fontWeight: '400',
    fontColor: '#cccccc',
    textAlign: 'left',
    fontFamily: 'Work Sans',
    fontId: 'gfont-work-sans',
    lineHeight: 1.3,
    role: 'body',
  };
}

export function makeRectNode(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = '#6457f0'
): SlideNode {
  return {
    id: uuidv4(),
    type: 'rect',
    name,
    x, y, width, height,
    visible: true,
    opacity: 1,
    rotation: 0,
    fill,
    fillOpacity: 1,
  };
}

export function makeEllipseNode(
  name: string,
  x: number,
  y: number,
  diameter: number,
  fill = '#6457f0'
): SlideNode {
  return {
    id: uuidv4(),
    type: 'ellipse',
    name,
    x, y,
    width: diameter,
    height: diameter,
    visible: true,
    opacity: 1,
    rotation: 0,
    fill,
    fillOpacity: 1,
  };
}

export function makeTextNode(
  x: number,
  y: number,
  width: number,
  height: number,
  slideWidth = 1920
): SlideNode {
  return {
    id: uuidv4(),
    type: 'text',
    name: 'Text',
    x, y, width, height,
    visible: true,
    opacity: 1,
    rotation: 0,
    text: 'Add text here',
    fontSize: bodySize(slideWidth),
    fontWeight: '400',
    fontColor: '#ffffff',
    textAlign: 'left',
    fontFamily: 'Work Sans',
    fontId: 'gfont-work-sans',
    lineHeight: 1.3,
  };
}

// A picture the user adds from disk, fitted inside the slide.
export function makeImageNode(
  name: string,
  dataUrl: string,
  naturalW: number,
  naturalH: number,
  slideW: number,
  slideH: number
): SlideNode {
  const fit = Math.min(1, (slideW * 0.6) / naturalW, (slideH * 0.6) / naturalH);
  const width = Math.max(8, Math.round(naturalW * fit));
  const height = Math.max(8, Math.round(naturalH * fit));
  return {
    id: uuidv4(),
    type: 'image',
    name,
    x: Math.round((slideW - width) / 2),
    y: Math.round((slideH - height) / 2),
    width,
    height,
    visible: true,
    opacity: 1,
    rotation: 0,
    imageUrl: dataUrl,
    imageReplaced: true,
    role: 'image',
  };
}

// Read a user-picked image file as a data URL plus its natural size.
// Pictures added to slides are reduced to what a slide can show: phone
// photos and 4K images (several MB) made uploads to Penpot take 15–20 s per
// render and bloated the deck saved in the file. Small files, SVG and GIF
// (animation) are kept as they are.
const IMAGE_MAX_SIDE = 2560;
const IMAGE_KEEP_BYTES = 600_000;

export function readImageFile(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => {
      const original = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth || 400;
        const height = img.naturalHeight || 300;
        const keep =
          /^data:image\/(svg\+xml|gif)/.test(original) ||
          (file.size <= IMAGE_KEEP_BYTES && Math.max(width, height) <= IMAGE_MAX_SIDE);
        if (keep) {
          resolve({ dataUrl: original, width, height });
          return;
        }
        const ratio = Math.min(1, IMAGE_MAX_SIDE / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ dataUrl: original, width, height });
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // PNG/WebP may be transparent; everything else is a photo.
        const transparent = /^data:image\/(png|webp)/.test(original) && hasTransparency(ctx, canvas.width, canvas.height);
        const reduced = transparent ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88);
        // Size and aspect are those of the picture, not of the reduced copy.
        resolve({ dataUrl: reduced.length < original.length ? reduced : original, width, height });
      };
      img.onerror = () => reject(new Error('The file is not a supported image.'));
      img.src = original;
    };
    reader.readAsDataURL(file);
  });
}

function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    const { data } = ctx.getImageData(0, 0, width, height);
    for (let i = 3; i < data.length; i += 4 * 16) if (data[i] < 250) return true;
    return false;
  } catch {
    return true;
  }
}

// ─── Misc Helpers ─────────────────────────────────────────────────────────────

export function getFilteredComponents(components: ComponentInfo[], query: string): ComponentInfo[] {
  if (!query.trim()) return components;
  const q = query.toLowerCase();
  return components.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.path.toLowerCase().includes(q)
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Walk the slide tree and return the node with the given id, or null. Used by
// the canvas to snapshot positions for multi-drag regardless of whether the
// node lives at the top level or inside a group.
export function findNodeById(nodes: SlideNode[], id: string): SlideNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNodeById(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

// Like findNodeById but also returns the accumulated parent offset so the
// caller can reproduce the node at an absolute slide position (used by paste
// to lift children out of groups and by any code that needs "where does this
// node actually sit on the slide").
export function findNodeAbs(
  nodes: SlideNode[],
  id: string,
  offsetX = 0,
  offsetY = 0
): { node: SlideNode; absX: number; absY: number } | null {
  for (const n of nodes) {
    if (n.id === id) return { node: n, absX: offsetX + n.x, absY: offsetY + n.y };
    if (n.children) {
      const f = findNodeAbs(n.children, id, offsetX + n.x, offsetY + n.y);
      if (f) return f;
    }
  }
  return null;
}

// ─── Web font loading ─────────────────────────────────────────────────────────

// Penpot stores the CSS-renderable family name (e.g. "Work Sans") on
// `shape.fontFamily`, but the plugin iframe does not inherit the host's loaded
// fonts. We inject Google Fonts stylesheets on demand so the canvas/thumbnail
// previews render the actual typeface instead of falling back to sans-serif.
const LOADED_FONT_FAMILIES = new Set<string>();
const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  'inherit', 'initial', 'unset',
]);

export function ensureFontLoaded(family: string | undefined | null): void {
  if (!family) return;
  if (typeof document === 'undefined') return;

  const clean = family.trim().replace(/^["']|["']$/g, '');
  if (!clean) return;
  if (GENERIC_FAMILIES.has(clean.toLowerCase())) return;
  if (LOADED_FONT_FAMILIES.has(clean)) return;
  LOADED_FONT_FAMILIES.add(clean);

  const query = encodeURIComponent(clean).replace(/%20/g, '+');
  const add = (query: string, onError?: () => void) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${query}&display=swap`;
    link.crossOrigin = 'anonymous';
    if (onError) link.onerror = onError;
    document.head.appendChild(link);
  };
  // Google rejects the whole request when one weight/style doesn't exist
  // (single-weight display fonts…): fall back to the family's default.
  add(
    `${query}:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,400;1,700`,
    () => add(query)
  );
}

// Return a CSS `font-family` value with safe fallbacks, and request the
// stylesheet for the primary family as a side-effect so the browser can use
// it as soon as it arrives. Generic families are passed through unchanged.
export function fontFamilyCss(family: string | undefined | null): string {
  if (!family) return 'sans-serif';
  const clean = family.trim().replace(/^["']|["']$/g, '');
  if (!clean) return 'sans-serif';
  if (GENERIC_FAMILIES.has(clean.toLowerCase())) return clean;
  ensureFontLoaded(clean);
  return `"${clean}", sans-serif`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

// ─── Penpot Fill → CSS conversion ─────────────────────────────────────────────

// Duck-typed shape of a Penpot `Fill` — we avoid pulling the Penpot namespace
// into the UI bundle, so fills arrive as `unknown[]` via postMessage and are
// narrowed structurally here.
type PenpotFillLike = {
  fillColor?: string;
  fillOpacity?: number;
  fillColorGradient?: {
    type: 'linear' | 'radial';
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    width?: number;
    stops: Array<{ color: string; opacity?: number; offset: number }>;
  };
  fillImage?: unknown;
};

function colorWithOpacity(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  const rgb = hexToRgb(color);
  if (!rgb) return color;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function gradientToCss(g: NonNullable<PenpotFillLike['fillColorGradient']>): string {
  const stops = g.stops
    .map((s) => {
      const color = colorWithOpacity(s.color ?? '#000000', s.opacity ?? 1);
      return `${color} ${(s.offset * 100).toFixed(2)}%`;
    })
    .join(', ');

  if (g.type === 'linear') {
    // Penpot gradient is defined in normalized shape coords (y grows downward).
    // CSS `linear-gradient` 0deg points up; atan2(dy, dx) gives the angle from
    // the +x axis going clockwise in screen space, and +90° rotates it so that
    // "downward in shape" matches "downward in CSS" (180deg).
    const dx = g.endX - g.startX;
    const dy = g.endY - g.startY;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    return `linear-gradient(${angle.toFixed(2)}deg, ${stops})`;
  }

  const cx = (g.startX * 100).toFixed(2);
  const cy = (g.startY * 100).toFixed(2);
  const dx = g.endX - g.startX;
  const dy = g.endY - g.startY;
  const radius = Math.sqrt(dx * dx + dy * dy);
  const r = Math.max(0.01, radius) * 100;
  return `radial-gradient(${r.toFixed(2)}% ${r.toFixed(2)}% at ${cx}% ${cy}%, ${stops})`;
}

// Convert a Penpot `Fill[]` snapshot into a CSS `background` value so the
// plugin preview matches what will be exported. Returns `undefined` when the
// array is empty or contains only unsupported fills (e.g. pure image fills
// with no resolvable URL) — callers should fall back to `node.imageUrl` or the
// flat `fill` color.
export function fillsToCss(fills: unknown[] | undefined, imageUrl?: string): string | undefined {
  if (!fills || fills.length === 0) return undefined;

  // Fast-path: one solid color.
  if (fills.length === 1) {
    const only = fills[0] as PenpotFillLike;
    if (only.fillColor && !only.fillColorGradient && !only.fillImage) {
      return colorWithOpacity(only.fillColor, only.fillOpacity ?? 1);
    }
  }

  const layers: string[] = [];
  for (const raw of fills) {
    const f = raw as PenpotFillLike;
    if (f.fillColorGradient) {
      layers.push(gradientToCss(f.fillColorGradient));
    } else if (f.fillColor) {
      // Wrap solid colors in a trivial gradient so they compose with other
      // layers in the comma-separated `background` shorthand.
      const color = colorWithOpacity(f.fillColor, f.fillOpacity ?? 1);
      layers.push(`linear-gradient(${color}, ${color})`);
    }
    else if (f.fillImage && imageUrl) {
      // The picture was read by the importer (or replaced in the editor);
      // it keeps its place in the stack so overlays still cover it.
      layers.push(`center / cover no-repeat url("${imageUrl}")`);
    }
  }

  if (layers.length === 0) return undefined;
  return layers.join(', ');
}

// An image fill paints on top of the colour fills of the stack (it is
// usually the last fill), stretched like Penpot's "fill" image mode.
export function nodeBackground(
  fills: unknown[] | undefined,
  flat: string | undefined,
  imageUrl: string | undefined
): string | undefined {
  const hasImageFill = (fills ?? []).some((f) => !!(f as { fillImage?: unknown }).fillImage);
  if (hasImageFill && imageUrl) return fillsToCss(fills, imageUrl);
  return withImageLayer(fillsToCss(fills) ?? flat, imageUrl);
}

function withImageLayer(background: string | undefined, imageUrl: string | undefined): string | undefined {
  if (!imageUrl) return background;
  const image = `center / cover no-repeat url("${imageUrl}")`;
  return background && background !== 'transparent' ? `${image}, ${background}` : image;
}

export function slideBackgroundCss(slide: Slide): string {
  return nodeBackground(slide.backgroundFills, slide.background, slide.backgroundImageUrl) ?? slide.background;
}

// Pull the first usable solid color out of a fills array — used for text
// color, which CSS cannot gradient-fill without extra tricks.
export function firstFillColor(fills: unknown[] | undefined): string | undefined {
  if (!fills || fills.length === 0) return undefined;
  for (const raw of fills) {
    const f = raw as PenpotFillLike;
    if (f.fillColor) return colorWithOpacity(f.fillColor, f.fillOpacity ?? 1);
    if (f.fillColorGradient && f.fillColorGradient.stops.length > 0) {
      const s = f.fillColorGradient.stops[0];
      return colorWithOpacity(s.color ?? '#000000', s.opacity ?? 1);
    }
  }
  return undefined;
}

// ─── Fill editing ─────────────────────────────────────────────────────────────

// Normalise "#abc" / "#AABBCC" to "#aabbcc"; anything else → null.
export function normalizeHex(value: string): string | null {
  const v = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
}

// Color shown in a picker for a fills stack: the first solid fill, else the
// first gradient stop, else the flat fallback field.
export function primaryFillHex(fills: unknown[] | undefined, fallback: string): string {
  for (const raw of fills ?? []) {
    const f = raw as PenpotFillLike;
    if (f.fillColor && !f.fillColorGradient && !f.fillImage) return normalizeHex(f.fillColor) ?? fallback;
  }
  for (const raw of fills ?? []) {
    const f = raw as PenpotFillLike;
    const stop = f.fillColorGradient?.stops[0];
    if (stop?.color) return normalizeHex(stop.color) ?? fallback;
  }
  return normalizeHex(fallback) ?? '#000000';
}

// Replace the color of the primary (first solid) fill while keeping its
// opacity and every other fill in the stack (gradients, images, overlays).
// The library color link is dropped on purpose: the value no longer matches
// the library color. Returns undefined when there was no snapshot, so the
// caller falls back to the flat field.
export function withPrimaryFillColor(fills: unknown[] | undefined, hex: string): unknown[] | undefined {
  if (!fills || fills.length === 0) return undefined;
  const idx = fills.findIndex((raw) => {
    const f = raw as PenpotFillLike;
    return !!f.fillColor && !f.fillColorGradient && !f.fillImage;
  });
  const solid = (prev?: PenpotFillLike) => ({ fillColor: hex, fillOpacity: prev?.fillOpacity ?? 1 });
  if (idx === -1) return [solid(), ...fills];
  return fills.map((raw, i) => (i === idx ? solid(raw as PenpotFillLike) : raw));
}

// Replace the primary fill with a complete fill (e.g. a library color that
// carries `fillColorRefId` / `fillColorRefFile`, which keeps the link in
// Penpot), keeping the rest of the stack.
export function withPrimaryFill(fills: unknown[] | undefined, fill: Record<string, unknown>): unknown[] {
  if (!fills || fills.length === 0) return [fill];
  const idx = fills.findIndex((raw) => {
    const f = raw as PenpotFillLike;
    return !!f.fillColor && !f.fillColorGradient && !f.fillImage;
  });
  if (idx === -1) return [fill, ...fills];
  return fills.map((raw, i) => (i === idx ? fill : raw));
}

// Id of the library color the primary fill is linked to, if any.
export function primaryFillRef(fills: unknown[] | undefined): string | undefined {
  for (const raw of fills ?? []) {
    const f = raw as PenpotFillLike & { fillColorRefId?: string };
    if (f.fillColor && !f.fillColorGradient && !f.fillImage) return f.fillColorRefId;
  }
  return undefined;
}

// ─── Text rendering ───────────────────────────────────────────────────────────

// CSS for a text node, shared by the editor canvas and the slide thumbnails
// so both previews agree with each other and with what export writes back.
// `scale` converts slide units to screen pixels (1 for thumbnails, which are
// scaled as a whole with a CSS transform).
export function textNodeCss(node: SlideNode, scale: number): import('react').CSSProperties {
  const justify =
    node.verticalAlign === 'center' ? 'center' : node.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start';
  return {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: justify,
    color: firstFillColor(node.fills) ?? node.fontColor ?? '#000000',
    fontSize: (node.fontSize ?? 14) * scale,
    fontWeight: node.fontWeight ?? '400',
    fontStyle: node.fontStyle ?? 'normal',
    fontFamily: fontFamilyCss(node.fontFamily),
    textAlign: node.textAlign ?? 'left',
    textTransform: node.textTransform ?? 'none',
    textDecoration: node.textDecoration ?? 'none',
    lineHeight: node.lineHeight ?? 1.2,
    letterSpacing: node.letterSpacing ? `${node.letterSpacing * scale}px` : undefined,
    overflow: 'hidden',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  };
}
