import { beforeEach, describe, expect, it } from 'vitest';
import { useSlideStore } from './store';
import { node, slide } from './test/factories';

const get = () => useSlideStore.getState();

beforeEach(() => {
  useSlideStore.setState({
    slides: [
      slide('s1', [
        node('a', { x: 10 }),
        node('g', { type: 'group', x: 100, y: 100, children: [node('k', { x: 5, y: 5 })] }),
        node('b'),
      ]),
      slide('s2', []),
      slide('s3', []),
    ],
    activeSlideId: 's1',
    selectedNodeIds: [],
    history: { past: [], future: [] },
  });
});

const ids = () => get().slides[0].nodes.map((n) => n.id);

describe('nodes', () => {
  it('moves top-level and nested nodes in one update', () => {
    get().moveNodes('s1', new Map([['a', { dx: 5, dy: 1 }], ['k', { dx: -5, dy: 0 }]]));
    const [a, g] = get().slides[0].nodes;
    expect([a.x, a.y]).toEqual([15, 1]);
    expect(g.children![0].x).toBe(0);
  });
  it('restacks: forward, front and back', () => {
    get().reorderNode('s1', 'a', 'forward');
    expect(ids()).toEqual(['g', 'a', 'b']);
    get().reorderNode('s1', 'g', 'front');
    expect(ids()).toEqual(['a', 'b', 'g']);
    get().reorderNode('s1', 'g', 'back');
    expect(ids()).toEqual(['g', 'a', 'b']);
  });
  it('marks a slot edited only when its content changes', () => {
    useSlideStore.setState({ slides: [slide('s1', [node('t', { type: 'text', text: 'x', slotId: 'slot' })])] });
    get().updateNode('s1', 't', { x: 50 });
    expect(get().slides[0].nodes[0].edited).toBeUndefined();
    get().updateNode('s1', 't', { text: 'y' });
    expect(get().slides[0].nodes[0].edited).toBe(true);
  });
});

describe('history', () => {
  it('undoes and redoes a committed change', () => {
    get().commitHistory();
    get().deleteNode('s1', 'a');
    expect(ids()).toEqual(['g', 'b']);
    get().undo();
    expect(ids()).toEqual(['a', 'g', 'b']);
    get().redo();
    expect(ids()).toEqual(['g', 'b']);
  });
  it('coalesces bursts on the same key', () => {
    get().commitHistoryCoalesced('k');
    get().commitHistoryCoalesced('k');
    get().commitHistoryCoalesced('other');
    expect(get().history.past).toHaveLength(2);
  });
});

describe('slides', () => {
  it('deleting the active slide selects its neighbour', () => {
    get().setActiveSlide('s2');
    get().deleteSlide('s2');
    expect(get().activeSlideId).toBe('s3');
  });
  it('duplicates with fresh node ids right after the source', () => {
    get().duplicateSlide('s1');
    const [orig, copy] = get().slides;
    expect(copy.nodes.map((n) => n.id)).not.toContain('a');
    expect(copy.nodes).toHaveLength(orig.nodes.length);
    expect(get().activeSlideId).toBe(copy.id);
  });
  it('switching view clears the node selection', () => {
    get().setSelectedNodes(['a']);
    get().setEditorView('grid');
    expect(get().selectedNodeIds).toEqual([]);
  });
});
