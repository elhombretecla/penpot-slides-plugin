import type { Slide } from '../types';
import type { SlideRender } from './types';
import { frameSignature, nodeSignature } from './keys';

// How to draw a slide from a (possibly slightly outdated) Penpot render:
// unchanged top-level nodes come from the render, nodes edited since — or
// being edited right now — are drawn by the HTML renderer and hidden in the
// SVG until the next render lands.
export interface RenderPlan {
  render: SlideRender;
  // Top-level node ids to hide inside the SVG.
  hidden: string[];
  // Top-level node ids that must be drawn as HTML.
  html: Set<string>;
  fresh: boolean;
}

export function planRender(
  slide: Slide,
  render: SlideRender | undefined,
  liveNodeId?: string | null
): RenderPlan | null {
  if (!render || render.frameSig !== frameSignature(slide)) return null;

  const rendered = new Set(render.nodes);
  const byId = new Map(slide.nodes.map((n) => [n.id, n]));

  // Stacking order changed: the SVG cannot be re-layered, start over.
  const common = slide.nodes.filter((n) => rendered.has(n.id)).map((n) => n.id);
  const renderedCommon = render.nodes.filter((id) => byId.has(id));
  if (common.join() !== renderedCommon.join()) return null;

  const html = new Set<string>();
  const hidden: string[] = [];
  for (const node of slide.nodes) {
    if (!node.visible) continue;
    const inRender = rendered.has(node.id);
    if (!inRender || render.nodeSigs[node.id] !== nodeSignature(node) || node.id === liveNodeId) {
      html.add(node.id);
      if (inRender) hidden.push(node.id);
    }
  }
  for (const id of render.nodes) {
    const node = byId.get(id);
    if (!node || !node.visible) hidden.push(id);
  }
  return { render, hidden, html, fresh: html.size === 0 && hidden.length === 0 };
}
