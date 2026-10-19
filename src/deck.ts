import { v4 as uuidv4 } from 'uuid';
import type {
  Deck,
  DeckSummary,
  ImportedComponentPayload,
  Slide,
  SlideNode,
  SlotRole,
} from './types';
import { DECK_SCHEMA_VERSION, SLIDE_SIZE_PRESETS } from './types';
import { hashString, slideRenderKey } from './render/keys';

// ─── Persistence format ───────────────────────────────────────────────────────
// Decks are stored as JSON in the Penpot file. Heavy previews are kept out of
// the node tree: SVG previews are regenerated from `svgMarkup`, and raster
// data URLs go into a media table so a logo used on ten slides is stored once.

const SVG_SENTINEL = 'svg:';
const MEDIA_PREFIX = 'media:';

interface StoredDeck extends Omit<Deck, 'slides'> {
  slides: Slide[];
  media: Record<string, string>;
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function mapTree(nodes: SlideNode[], fn: (n: SlideNode) => SlideNode): SlideNode[] {
  return nodes.map((n) => {
    const next = fn(n);
    return next.children ? { ...next, children: mapTree(next.children, fn) } : next;
  });
}

export function serializeDeck(deck: Deck): string {
  const media: Record<string, string> = {};
  const pack = (n: SlideNode): SlideNode => {
    if (!n.imageUrl) return n;
    if (n.svgMarkup && !n.imageReplaced && n.imageUrl === svgDataUrl(n.svgMarkup)) {
      return { ...n, imageUrl: SVG_SENTINEL };
    }
    if (n.imageUrl.startsWith('data:')) {
      const key = hashString(n.imageUrl);
      media[key] = n.imageUrl;
      return { ...n, imageUrl: MEDIA_PREFIX + key };
    }
    return n;
  };
  const stored: StoredDeck = {
    ...deck,
    schemaVersion: DECK_SCHEMA_VERSION,
    slides: deck.slides.map((s) => ({
      ...s,
      backgroundImageUrl: s.backgroundImageUrl ? pack({ imageUrl: s.backgroundImageUrl } as SlideNode).imageUrl : undefined,
      nodes: mapTree(s.nodes, pack),
    })),
    media,
  };
  return JSON.stringify(stored);
}

export function parseDeck(raw: string): Deck {
  const data = JSON.parse(raw) as Partial<StoredDeck>;
  if (!data || typeof data !== 'object' || !Array.isArray(data.slides)) {
    throw new Error('The stored presentation is not valid.');
  }
  if ((data.schemaVersion ?? 0) > DECK_SCHEMA_VERSION) {
    throw new Error('This presentation was saved by a newer version of the plugin.');
  }
  const media = data.media ?? {};
  const unpack = (n: SlideNode): SlideNode => {
    if (n.imageUrl === SVG_SENTINEL) {
      return { ...n, imageUrl: n.svgMarkup ? svgDataUrl(n.svgMarkup) : undefined };
    }
    if (n.imageUrl?.startsWith(MEDIA_PREFIX)) {
      return { ...n, imageUrl: media[n.imageUrl.slice(MEDIA_PREFIX.length)] };
    }
    return n;
  };
  const now = Date.now();
  return {
    schemaVersion: DECK_SCHEMA_VERSION,
    id: data.id ?? uuidv4(),
    name: data.name || 'Untitled presentation',
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
    libraryId: data.libraryId,
    libraryName: data.libraryName,
    exportSettings: data.exportSettings,
    slides: data.slides.map((s) => ({
      ...s,
      backgroundImageUrl: s.backgroundImageUrl
        ? unpack({ imageUrl: s.backgroundImageUrl } as SlideNode).imageUrl
        : undefined,
      nodes: mapTree(s.nodes ?? [], unpack),
    })),
  };
}

export function summarizeDeck(deck: Deck): DeckSummary {
  const first = deck.slides[0];
  return {
    id: deck.id,
    name: deck.name,
    slideCount: deck.slides.length,
    updatedAt: deck.updatedAt,
    width: first?.width ?? SLIDE_SIZE_PRESETS['16:9'].width,
    height: first?.height ?? SLIDE_SIZE_PRESETS['16:9'].height,
    libraryName: deck.libraryName,
    coverKey: first ? slideRenderKey(first) : undefined,
  };
}

export function createDeck(name: string, library?: { id: string; name: string }): Deck {
  const now = Date.now();
  return {
    schemaVersion: DECK_SCHEMA_VERSION,
    id: uuidv4(),
    name,
    createdAt: now,
    updatedAt: now,
    libraryId: library?.id,
    libraryName: library?.name,
    slides: [],
  };
}

// ─── Node tree helpers ────────────────────────────────────────────────────────

// Deep-clone a node tree with fresh ids. `keepSlots` keeps the template slot
// binding (duplicating a slide); a pasted copy is a new element, not the slot.
export function cloneNodeWithNewIds(node: SlideNode, keepSlots = true): SlideNode {
  const copy = JSON.parse(JSON.stringify(node)) as SlideNode;
  const reassign = (n: SlideNode) => {
    n.id = uuidv4();
    if (!keepSlots) {
      delete n.slotId;
      delete n.edited;
    }
    n.children?.forEach(reassign);
  };
  reassign(copy);
  return copy;
}

interface PlacedNode {
  node: SlideNode;
  absX: number;
  absY: number;
}

function flatten(nodes: SlideNode[], offsetX = 0, offsetY = 0, out: PlacedNode[] = []): PlacedNode[] {
  for (const n of nodes) {
    const absX = offsetX + n.x;
    const absY = offsetY + n.y;
    out.push({ node: n, absX, absY });
    if (n.children && n.type !== 'component-instance') flatten(n.children, absX, absY, out);
  }
  return out;
}

const readingOrder = (a: PlacedNode, b: PlacedNode) =>
  Math.abs(a.absY - b.absY) > 8 ? a.absY - b.absY : a.absX - b.absX;

function hasImageFill(n: SlideNode): boolean {
  return (n.fills ?? []).some((f) => !!(f as { fillImage?: unknown }).fillImage);
}

export function isImageNode(n: SlideNode): boolean {
  return n.type === 'image' || n.imageReplaced === true || (n.type !== 'group' && hasImageFill(n));
}

// ─── Slot roles ───────────────────────────────────────────────────────────────

// Infer what each template slot is for from typography and geometry: the
// biggest text read first is the title, other big texts are subtitles, short
// small texts are captions. Explicit roles are kept.
export function inferRoles(nodes: SlideNode[]): SlideNode[] {
  const placed = flatten(nodes);
  const texts = placed.filter((p) => p.node.type === 'text' && p.node.visible).sort(readingOrder);
  const sizes = texts.map((p) => p.node.fontSize ?? 14);
  const max = Math.max(0, ...sizes);
  const sorted = [...sizes].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  const roles = new Map<string, SlotRole>();
  let titleTaken = false;
  for (const p of texts) {
    const size = p.node.fontSize ?? 14;
    const length = (p.node.text ?? '').trim().length;
    let role: SlotRole;
    if (size >= max * 0.85 && !titleTaken) {
      role = 'title';
      titleTaken = true;
    } else if (size >= max * 0.55 && size > median) {
      role = 'subtitle';
    } else if (length <= 40 && size < median * 0.85) {
      role = 'caption';
    } else {
      role = 'body';
    }
    roles.set(p.node.id, role);
  }
  for (const p of placed) {
    const n = p.node;
    if (roles.has(n.id)) continue;
    if (n.type === 'component-instance') roles.set(n.id, 'asset');
    else if (isImageNode(n)) roles.set(n.id, 'image');
    else if (n.type !== 'group' && n.type !== 'text') roles.set(n.id, 'decoration');
  }

  return mapTree(nodes, (n) => (n.role || !roles.has(n.id) ? n : { ...n, role: roles.get(n.id) }));
}

// ─── Slides from templates ────────────────────────────────────────────────────

// Build a slide from an imported (possibly cached) component. Node ids are
// regenerated so the same template can be added several times without two
// slides sharing ids (selection, copy/paste and history rely on uniqueness).
export function slideFromImported(
  payload: ImportedComponentPayload,
  fallback: { name: string; width?: number; height?: number }
): Slide {
  const defaultSize = SLIDE_SIZE_PRESETS['16:9'];
  return {
    id: uuidv4(),
    name: payload.componentName || fallback.name,
    source: 'library-component',
    width: payload.width || fallback.width || defaultSize.width,
    height: payload.height || fallback.height || defaultSize.height,
    background: payload.background,
    backgroundFills: payload.backgroundFills,
    backgroundImageUrl: payload.backgroundImageUrl,
    nodes: inferRoles(payload.nodes.map((n) => cloneNodeWithNewIds(n))),
    template: {
      libraryId: payload.libraryId,
      libraryName: payload.libraryName,
      componentId: payload.componentId,
      componentName: payload.componentName,
      path: payload.path,
    },
  };
}

const ROLE_FALLBACKS: Record<SlotRole, SlotRole[]> = {
  title: ['title', 'subtitle', 'body'],
  subtitle: ['subtitle', 'body', 'title'],
  body: ['body', 'subtitle', 'caption'],
  caption: ['caption', 'body', 'subtitle'],
  image: ['image'],
  asset: [],
  decoration: [],
};

export interface LayoutChangeResult {
  slide: Slide;
  // Edited content that had no matching slot and was kept as free elements.
  keptAsElements: number;
}

// "Change layout": rebuild the slide from another template and carry the
// user's content over. Edited texts / images go into the new template's
// slots by role (title → title, falling back to similar roles) and reading
// order; edited content with no free slot stays as a regular element at its
// old position; elements the user added are kept as they are.
export function applyLayout(old: Slide, payload: ImportedComponentPayload): LayoutChangeResult {
  const fresh = slideFromImported(payload, { name: old.name });
  const oldPlaced = flatten(old.nodes).sort(readingOrder);

  const editedTexts = oldPlaced.filter((p) => p.node.slotId && p.node.edited && p.node.type === 'text');
  const editedImages = oldPlaced.filter((p) => p.node.slotId && p.node.imageReplaced);
  const userAdded = old.nodes.filter((n) => !n.slotId);

  const freshPlaced = flatten(fresh.nodes).sort(readingOrder);
  const freeSlots = new Map<SlotRole, SlideNode[]>();
  for (const p of freshPlaced) {
    const role = p.node.role;
    if (!role || !p.node.slotId) continue;
    if (role === 'image' ? !isImageNode(p.node) : p.node.type !== 'text') continue;
    freeSlots.set(role, [...(freeSlots.get(role) ?? []), p.node]);
  }

  const patches = new Map<string, Partial<SlideNode>>();
  const leftovers: PlacedNode[] = [];
  const take = (role: SlotRole | undefined): SlideNode | null => {
    for (const r of ROLE_FALLBACKS[role ?? 'body']) {
      const list = freeSlots.get(r);
      if (list && list.length > 0) return list.shift()!;
    }
    return null;
  };

  for (const p of editedTexts) {
    const target = take(p.node.role);
    if (target) patches.set(target.id, { text: p.node.text, edited: true });
    else leftovers.push(p);
  }
  for (const p of editedImages) {
    const target = take('image');
    if (target) patches.set(target.id, { imageUrl: p.node.imageUrl, imageReplaced: true, edited: true });
    else leftovers.push(p);
  }

  const nodes = mapTree(fresh.nodes, (n) => (patches.has(n.id) ? { ...n, ...patches.get(n.id) } : n));
  const extras = leftovers.map((p) => {
    const copy = cloneNodeWithNewIds(p.node, false);
    return { ...copy, x: p.absX, y: p.absY };
  });

  const keepName = old.template && old.name !== old.template.componentName;
  return {
    slide: {
      ...fresh,
      id: old.id,
      name: keepName ? old.name : fresh.name,
      notes: old.notes,
      nodes: [...nodes, ...userAdded, ...extras],
    },
    keptAsElements: extras.length,
  };
}

// "Reset slide": back to the template's content, keeping identity and notes.
export function resetToTemplate(old: Slide, payload: ImportedComponentPayload): Slide {
  const fresh = slideFromImported(payload, { name: old.name });
  return { ...fresh, id: old.id, name: old.name, notes: old.notes };
}
