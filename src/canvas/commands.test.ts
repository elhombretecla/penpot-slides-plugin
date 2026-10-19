import { describe, expect, it } from 'vitest';
import { dropDominatedIds, freeCopies } from './commands';
import { node, slide } from '../test/factories';

const s = slide('s', [
  node('g', { type: 'group', x: 100, y: 100, children: [node('child', { x: 10, y: 20, slotId: 'slot-1', edited: true })] }),
  node('free', { x: 5, y: 5 }),
]);

describe('dropDominatedIds', () => {
  it('drops children whose parent is selected', () => {
    expect(dropDominatedIds(s.nodes, ['child', 'g', 'free'])).toEqual(['g', 'free']);
  });
});

describe('freeCopies', () => {
  it('copies nested nodes as free elements at their absolute position', () => {
    const [copy] = freeCopies(s, ['child']);
    expect(copy.absX).toBe(110);
    expect(copy.absY).toBe(120);
    expect(copy.node.id).not.toBe('child');
    expect(copy.node.slotId).toBeUndefined();
    expect(copy.node.edited).toBeUndefined();
  });
  it('gives every copied descendant a new id', () => {
    const [copy] = freeCopies(s, ['g']);
    expect(copy.node.children?.[0].id).not.toBe('child');
  });
});
