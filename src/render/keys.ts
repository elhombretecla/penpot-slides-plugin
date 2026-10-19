import type { Slide, SlideNode } from '../types';

// Content fingerprints for the render engine. Slides and nodes are immutable
// in the store, so signatures are memoised per object and an edit only
// re-hashes what it touched.

export function hashString(value: string): string {
  // FNV-1a, 32 bit, plus length to make collisions on big strings unlikely.
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + value.length.toString(36);
}

const nodeSigs = new WeakMap<SlideNode, string>();
const frameSigs = new WeakMap<Slide, string>();
const slideKeys = new WeakMap<Slide, string>();

export function nodeSignature(node: SlideNode): string {
  let sig = nodeSigs.get(node);
  if (!sig) {
    sig = hashString(JSON.stringify(node));
    nodeSigs.set(node, sig);
  }
  return sig;
}

// What the board itself looks like (size and background).
export function frameSignature(slide: Slide): string {
  let sig = frameSigs.get(slide);
  if (!sig) {
    sig = hashString(
      JSON.stringify([
        slide.width,
        slide.height,
        slide.background,
        slide.backgroundFills ?? null,
        slide.backgroundImageUrl ?? null,
        // A template slide without nodes is rendered as a linked instance.
        slide.nodes.length === 0 ? slide.template?.componentId ?? null : null,
      ])
    );
    frameSigs.set(slide, sig);
  }
  return sig;
}

// Everything that affects the rendered picture; the slide's name and notes
// do not, so renaming never invalidates a render.
export function slideRenderKey(slide: Slide): string {
  let key = slideKeys.get(slide);
  if (!key) {
    key = hashString(frameSignature(slide) + '|' + slide.nodes.map(nodeSignature).join(','));
    slideKeys.set(slide, key);
  }
  return key;
}
