import type { SlideNode } from '../types';

// Slide-space geometry for the editor: absolute boxes, smart-guide snapping
// and align / distribute. Rotation is ignored (boxes are the unrotated
// frames), like Penpot does for its own snapping of rotated shapes' frames.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedBox extends Box {
  id: string;
  node: SlideNode;
  // Offset of the node's parent: absolute = parent + node.x/y.
  parentX: number;
  parentY: number;
}

// Every visible node with its absolute box, parents before children.
export function placeNodes(nodes: SlideNode[], parentX = 0, parentY = 0, out: PlacedBox[] = []): PlacedBox[] {
  for (const node of nodes) {
    if (!node.visible) continue;
    const x = parentX + node.x;
    const y = parentY + node.y;
    out.push({ id: node.id, node, x, y, width: node.width, height: node.height, parentX, parentY });
    if (node.children && node.type !== 'component-instance') placeNodes(node.children, x, y, out);
  }
  return out;
}

export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const b of boxes) {
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.width);
    y2 = Math.max(y2, b.y + b.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

// Ids of `ids` plus all their descendants.
export function subtreeIds(nodes: SlideNode[], ids: string[]): Set<string> {
  const out = new Set<string>();
  const wanted = new Set(ids);
  const visit = (ns: SlideNode[], inside: boolean) => {
    for (const n of ns) {
      const hit = inside || wanted.has(n.id);
      if (hit) out.add(n.id);
      if (n.children) visit(n.children, hit);
    }
  };
  visit(nodes, false);
  return out;
}

// ─── Snapping ─────────────────────────────────────────────────────────────────

export interface Guide {
  axis: 'x' | 'y';
  // Position on the snapped axis, and the span it is drawn across.
  at: number;
  from: number;
  to: number;
}

export interface SnapTargets {
  x: Array<{ at: number; from: number; to: number }>;
  y: Array<{ at: number; from: number; to: number }>;
}

// Edges and centres of the slide and of every other visible node.
export function snapTargets(
  placed: PlacedBox[],
  exclude: Set<string>,
  slideWidth: number,
  slideHeight: number
): SnapTargets {
  const x: SnapTargets['x'] = [];
  const y: SnapTargets['y'] = [];
  const add = (b: Box) => {
    for (const at of [b.x, b.x + b.width / 2, b.x + b.width]) x.push({ at, from: b.y, to: b.y + b.height });
    for (const at of [b.y, b.y + b.height / 2, b.y + b.height]) y.push({ at, from: b.x, to: b.x + b.width });
  };
  add({ x: 0, y: 0, width: slideWidth, height: slideHeight });
  for (const p of placed) if (!exclude.has(p.id)) add(p);
  return { x, y };
}

// Best correction (within `threshold` slide units) that aligns one of the
// box's edges / centre on each axis to a target, plus the guides to draw.
// `edges` limits which sides may snap (a resize only moves some of them).
export function snapBox(
  box: Box,
  targets: SnapTargets,
  threshold: number,
  edges: { x: Array<'start' | 'center' | 'end'>; y: Array<'start' | 'center' | 'end'> } = {
    x: ['start', 'center', 'end'],
    y: ['start', 'center', 'end'],
  }
): { dx: number; dy: number; guides: Guide[] } {
  const along = (start: number, size: number, which: Array<'start' | 'center' | 'end'>) =>
    which.map((w) => (w === 'start' ? start : w === 'center' ? start + size / 2 : start + size));

  const best = (values: number[], list: SnapTargets['x']) => {
    let delta = Infinity;
    for (const v of values) {
      for (const t of list) {
        const d = t.at - v;
        if (Math.abs(d) <= threshold && Math.abs(d) < Math.abs(delta)) delta = d;
      }
    }
    return Number.isFinite(delta) ? delta : 0;
  };

  const xs = along(box.x, box.width, edges.x);
  const ys = along(box.y, box.height, edges.y);
  const dx = best(xs, targets.x);
  const dy = best(ys, targets.y);
  const snapped = { x: box.x + dx, y: box.y + dy, width: box.width, height: box.height };

  // Guides for every target the snapped box now touches exactly.
  const guides: Guide[] = [];
  const eps = 0.01;
  if (dx !== 0 || xs.some((v) => targets.x.some((t) => Math.abs(t.at - v) < eps))) {
    for (const v of along(snapped.x, snapped.width, edges.x)) {
      const hits = targets.x.filter((t) => Math.abs(t.at - v) < eps);
      if (hits.length === 0) continue;
      const from = Math.min(snapped.y, ...hits.map((h) => h.from));
      const to = Math.max(snapped.y + snapped.height, ...hits.map((h) => h.to));
      guides.push({ axis: 'x', at: v, from, to });
    }
  }
  if (dy !== 0 || ys.some((v) => targets.y.some((t) => Math.abs(t.at - v) < eps))) {
    for (const v of along(snapped.y, snapped.height, edges.y)) {
      const hits = targets.y.filter((t) => Math.abs(t.at - v) < eps);
      if (hits.length === 0) continue;
      const from = Math.min(snapped.x, ...hits.map((h) => h.from));
      const to = Math.max(snapped.x + snapped.width, ...hits.map((h) => h.to));
      guides.push({ axis: 'y', at: v, from, to });
    }
  }
  return { dx, dy, guides };
}

// ─── Align / distribute ───────────────────────────────────────────────────────

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type DistributeMode = 'horizontal' | 'vertical';

// Moves (in slide units) that align the boxes to `frame`: the selection's
// bounds, or the slide when a single element is selected.
export function alignMoves(boxes: PlacedBox[], frame: Box, mode: AlignMode): Map<string, { dx: number; dy: number }> {
  const moves = new Map<string, { dx: number; dy: number }>();
  for (const b of boxes) {
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = frame.x - b.x;
    if (mode === 'hcenter') dx = frame.x + frame.width / 2 - (b.x + b.width / 2);
    if (mode === 'right') dx = frame.x + frame.width - (b.x + b.width);
    if (mode === 'top') dy = frame.y - b.y;
    if (mode === 'vcenter') dy = frame.y + frame.height / 2 - (b.y + b.height / 2);
    if (mode === 'bottom') dy = frame.y + frame.height - (b.y + b.height);
    if (dx || dy) moves.set(b.id, { dx, dy });
  }
  return moves;
}

// Equal gaps between the boxes, keeping the outermost two in place.
export function distributeMoves(boxes: PlacedBox[], mode: DistributeMode): Map<string, { dx: number; dy: number }> {
  const moves = new Map<string, { dx: number; dy: number }>();
  if (boxes.length < 3) return moves;
  const horizontal = mode === 'horizontal';
  const start = (b: Box) => (horizontal ? b.x : b.y);
  const size = (b: Box) => (horizontal ? b.width : b.height);
  const sorted = [...boxes].sort((a, b) => start(a) - start(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = start(last) + size(last) - start(first);
  const used = sorted.reduce((sum, b) => sum + size(b), 0);
  const gap = (span - used) / (sorted.length - 1);
  let cursor = start(first) + size(first) + gap;
  for (const b of sorted.slice(1, -1)) {
    const d = cursor - start(b);
    if (Math.abs(d) > 0.001) moves.set(b.id, horizontal ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    cursor += size(b) + gap;
  }
  return moves;
}
