import type { Shape } from '@penpot/plugin-types';

// Penpot's client-side SVG of shapes (generateMarkup) and the clean-ups it
// needs. Everything but safeMarkup is pure and unit-tested.

// Client-side SVG of a shape (~50 ms, no server round-trip). Text inside the
// markup is only present when the shape lives on the current page, which is
// fine here: it is used for vectors, not for text.
export function safeMarkup(shape: Shape): string | undefined {
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

export function onlyRootTree(svg: string, rootId: string): string {
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
      else if (id && selfClosing) cuts.push([m.index, m.index + full.length]);
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
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Every call numbers its defs ("render-123") and stroke ids get fresh
// uuids: the same picture compared without any of them.
const VOLATILE_IDS_RE = /render-\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

export function stableMarkup(markup: string): string {
  return markup.replace(VOLATILE_IDS_RE, '');
}
