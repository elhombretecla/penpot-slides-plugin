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
  query: string,
  filter: string
): import('./types').ComponentInfo[] {
  let result = components;

  if (query.trim()) {
    const q = query.toLowerCase();
    result = result.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.path.toLowerCase().includes(q)
    );
  }

  if (filter !== 'All Slides') {
    const filterLower = filter.toLowerCase();
    result = result.filter(
      (c) =>
        c.name.toLowerCase().includes(filterLower) ||
        c.path.toLowerCase().includes(filterLower)
    );
  }

  return result;
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
