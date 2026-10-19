import { describe, expect, it } from 'vitest';
import { planRender } from './plan';
import { frameSignature, nodeSignature, slideRenderKey } from './keys';
import type { SlideRender } from './types';
import type { Slide } from '../types';
import { node, slide } from '../test/factories';

function renderOf(s: Slide): SlideRender {
  return {
    key: slideRenderKey(s),
    svg: '<svg/>',
    frameSig: frameSignature(s),
    nodeSigs: Object.fromEntries(s.nodes.map((n) => [n.id, nodeSignature(n)])),
    nodes: s.nodes.map((n) => n.id),
  };
}

const base = slide('s', [node('a'), node('b'), node('c')]);
const render = renderOf(base);

describe('planRender', () => {
  it('is fresh when nothing changed', () => {
    const plan = planRender(base, render)!;
    expect(plan.fresh).toBe(true);
    expect(plan.html.size).toBe(0);
  });
  it('draws edited and new nodes as HTML and hides the stale copy', () => {
    const edited = { ...base, nodes: [base.nodes[0], { ...base.nodes[1], x: 40 }, base.nodes[2], node('d')] };
    const plan = planRender(edited, render)!;
    expect([...plan.html].sort()).toEqual(['b', 'd']);
    expect(plan.hidden).toEqual(['b']);
  });
  it('hides deleted and invisible nodes', () => {
    const edited = { ...base, nodes: [base.nodes[0], { ...base.nodes[1], visible: false }] };
    const plan = planRender(edited, render)!;
    expect(plan.hidden.sort()).toEqual(['b', 'c']);
  });
  it('keeps the node being typed into live', () => {
    expect([...planRender(base, render, 'c')!.html]).toEqual(['c']);
  });
  it('gives up when the frame or the stacking changed', () => {
    expect(planRender({ ...base, background: '#000' }, render)).toBeNull();
    expect(planRender({ ...base, nodes: [base.nodes[1], base.nodes[0], base.nodes[2]] }, render)).toBeNull();
    expect(planRender(base, undefined)).toBeNull();
  });
});
