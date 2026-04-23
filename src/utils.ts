import { v4 as uuidv4 } from 'uuid';
import type { Slide, SlideNode, PresetLayout, SlideSizePreset } from './types';
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
        w * 0.1, h * 0.4, w * 0.8, h * 0.45
      ));
      break;

    case 'two-columns': {
      const colW = w * 0.42;
      nodes.push(makeTitleNode('Slide Title', w * 0.05, h * 0.06, w * 0.9, h * 0.15, w));
      nodes.push(makeBodyNode('Left Column', 'Left column content', w * 0.05, h * 0.28, colW, h * 0.58));
      nodes.push(makeBodyNode('Right Column', 'Right column content', w * 0.53, h * 0.28, colW, h * 0.58));
      break;
    }

    case 'image-caption': {
      nodes.push(makeRectNode('Image Placeholder', w * 0.05, h * 0.08, w * 0.9, h * 0.6, '#2d2d4e'));
      nodes.push(makeBodyNode('Caption', 'Image caption or description', w * 0.05, h * 0.72, w * 0.9, h * 0.2));
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
    fontFamily: 'sans-serif',
  };
}

export function makeBodyNode(
  name: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number
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
    fontSize: 18,
    fontWeight: '400',
    fontColor: '#cccccc',
    textAlign: 'left',
    fontFamily: 'sans-serif',
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
  height: number
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
    fontSize: 20,
    fontWeight: '400',
    fontColor: '#ffffff',
    textAlign: 'left',
    fontFamily: 'sans-serif',
  };
}

// ─── Misc Helpers ─────────────────────────────────────────────────────────────

export function isSlideLike(name: string): boolean {
  const lowerName = name.toLowerCase();
  const keywords = ['slide', 'cover', 'hero', 'title', 'intro', 'outro', 'closing', 'content', 'section'];
  return keywords.some((k) => lowerName.includes(k));
}

export function groupComponentsByPath(
  components: import('./types').ComponentInfo[]
): Record<string, import('./types').ComponentInfo[]> {
  const groups: Record<string, import('./types').ComponentInfo[]> = {};
  for (const comp of components) {
    const group = comp.path ? comp.path.split('/')[0] : 'Uncategorized';
    if (!groups[group]) groups[group] = [];
    groups[group].push(comp);
  }
  return groups;
}

export function getFilteredComponents(
  components: import('./types').ComponentInfo[],
  query: string
): import('./types').ComponentInfo[] {
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
export function fillsToCss(fills: unknown[] | undefined): string | undefined {
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
    // Image fills cannot be resolved from the UI bundle (the Penpot ImageData
    // id is opaque here); caller uses `node.imageUrl` as a fallback.
  }

  if (layers.length === 0) return undefined;
  return layers.join(', ');
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
