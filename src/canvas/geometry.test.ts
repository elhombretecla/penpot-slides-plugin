import { describe, expect, it } from 'vitest';
import { alignMoves, distributeMoves, placeNodes, snapBox, snapTargets, subtreeIds, unionBox } from './geometry';
import { node } from '../test/factories';

const nodes = [
  node('a', { x: 0, y: 0, width: 100, height: 50 }),
  node('b', { x: 300, y: 0, width: 100, height: 50 }),
  node('c', { x: 1000, y: 0, width: 200, height: 50 }),
  node('g', { type: 'group', x: 500, y: 500, width: 400, height: 400, children: [node('k', { x: 10, y: 10, width: 50, height: 50 })] }),
  node('hidden', { x: 5, y: 5, visible: false }),
];
const placed = placeNodes(nodes);
const byId = (id: string) => placed.find((p) => p.id === id)!;

describe('placeNodes', () => {
  it('gives nested nodes absolute boxes and their parent offset', () => {
    expect(byId('k')).toMatchObject({ x: 510, y: 510, parentX: 500, parentY: 500 });
  });
  it('skips hidden nodes', () => {
    expect(placed.some((p) => p.id === 'hidden')).toBe(false);
  });
});

describe('unionBox / subtreeIds', () => {
  it('bounds several boxes', () => {
    expect(unionBox([byId('a'), byId('c')])).toEqual({ x: 0, y: 0, width: 1200, height: 50 });
    expect(unionBox([])).toBeNull();
  });
  it('includes descendants only', () => {
    const ids = subtreeIds(nodes, ['g']);
    expect(ids.has('k')).toBe(true);
    expect(ids.has('a')).toBe(false);
  });
});

describe('snapBox', () => {
  const targets = snapTargets(placed, subtreeIds(nodes, ['a']), 1920, 1080);

  it('snaps the nearest edge within the threshold and reports a guide', () => {
    const s = snapBox({ x: 296, y: 200, width: 100, height: 50 }, targets, 6);
    expect(s.dx).toBe(4);
    expect(s.guides.some((g) => g.axis === 'x' && g.at === 300)).toBe(true);
  });
  it('snaps centres to the slide centre', () => {
    const s = snapBox({ x: 857, y: 515, width: 200, height: 50 }, targets, 6);
    expect(s.dx).toBe(3); // centre 957 → 960
    expect(s.dy).toBe(0); // centre 540: already aligned
  });
  it('does nothing out of range', () => {
    const s = snapBox({ x: 150, y: 150, width: 10, height: 10 }, targets, 6);
    expect(s).toMatchObject({ dx: 0, dy: 0 });
  });
  it('only moves the requested edges (resize)', () => {
    const s = snapBox({ x: 0, y: 0, width: 955, height: 50 }, targets, 6, { x: ['end'], y: [] });
    expect(s.dx).toBe(5);
    expect(s.dy).toBe(0);
  });
});

describe('align / distribute', () => {
  it('aligns to a frame', () => {
    const moves = alignMoves([byId('a'), byId('k')], { x: 0, y: 0, width: 1920, height: 1080 }, 'bottom');
    expect(moves.get('a')).toEqual({ dx: 0, dy: 1030 });
    expect(moves.get('k')).toEqual({ dx: 0, dy: 520 });
  });
  it('leaves aligned elements out', () => {
    expect(alignMoves([byId('a'), byId('b')], { x: 0, y: 0, width: 1, height: 1 }, 'top').size).toBe(0);
  });
  it('spaces three or more evenly, keeping the outer ones', () => {
    const moves = distributeMoves([byId('a'), byId('b'), byId('c')], 'horizontal');
    expect([...moves.keys()]).toEqual(['b']);
    expect(moves.get('b')).toEqual({ dx: 200, dy: 0 });
    expect(distributeMoves([byId('a'), byId('b')], 'horizontal').size).toBe(0);
  });
});
