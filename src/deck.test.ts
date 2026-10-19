import { describe, expect, it } from 'vitest';
import { applyLayout, cloneNodeWithNewIds, inferRoles, parseDeck, serializeDeck, svgDataUrl } from './deck';
import { DECK_SCHEMA_VERSION, type Deck, type ImportedComponentPayload } from './types';
import { node, slide } from './test/factories';

const PNG = 'data:image/png;base64,' + 'A'.repeat(200);

function deckWith(slides: Deck['slides']): Deck {
  return { schemaVersion: DECK_SCHEMA_VERSION, id: 'd', name: 'Deck', createdAt: 1, updatedAt: 2, slides };
}

describe('deck storage format', () => {
  it('round-trips and stores a picture used twice only once', () => {
    const svg = '<svg><rect/></svg>';
    const deck = deckWith([
      slide('s1', [node('a', { type: 'image', imageUrl: PNG }), node('v', { type: 'path', svgMarkup: svg, imageUrl: svgDataUrl(svg) })]),
      slide('s2', [node('b', { type: 'image', imageUrl: PNG })], { backgroundImageUrl: PNG }),
    ]);
    const raw = serializeDeck(deck);
    expect(raw.split(PNG).length - 1).toBe(1);
    expect(raw).not.toContain(encodeURIComponent(svg));
    expect(parseDeck(raw)).toMatchObject({ slides: deck.slides });
  });
  it('rejects garbage and newer schema versions', () => {
    expect(() => parseDeck('{"nope":1}')).toThrow();
    expect(() => parseDeck(JSON.stringify({ ...deckWith([]), schemaVersion: DECK_SCHEMA_VERSION + 1 }))).toThrow(/newer/);
  });
});

describe('cloneNodeWithNewIds', () => {
  const tree = node('g', { type: 'group', slotId: 's', children: [node('c', { slotId: 's2', edited: true })] });
  it('renews every id and keeps slots by default', () => {
    const copy = cloneNodeWithNewIds(tree);
    expect(copy.id).not.toBe('g');
    expect(copy.children![0].id).not.toBe('c');
    expect(copy.children![0].slotId).toBe('s2');
  });
  it('drops slot bindings for free copies', () => {
    const copy = cloneNodeWithNewIds(tree, false);
    expect(copy.slotId).toBeUndefined();
    expect(copy.children![0].edited).toBeUndefined();
  });
});

describe('inferRoles', () => {
  it('reads the biggest text as the title and small short texts as captions', () => {
    const nodes = inferRoles([
      node('t', { type: 'text', text: 'Title', fontSize: 96, y: 100 }),
      node('b', { type: 'text', text: 'A long paragraph of body copy that goes on.', fontSize: 32, y: 300 }),
      node('b2', { type: 'text', text: 'Another paragraph of body copy, also long.', fontSize: 32, y: 500 }),
      node('c', { type: 'text', text: 'Photo: me', fontSize: 18, y: 900 }),
      node('i', { type: 'image', imageUrl: PNG }),
    ]);
    expect(Object.fromEntries(nodes.map((n) => [n.id, n.role]))).toEqual({ t: 'title', b: 'body', b2: 'body', c: 'caption', i: 'image' });
  });
});

describe('applyLayout', () => {
  const payload: ImportedComponentPayload = {
    componentId: 'c2', libraryId: 'l', componentName: 'Two', background: '#fff', width: 1920, height: 1080, importedAt: 0,
    nodes: [node('new-title', { type: 'text', text: 'Template title', fontSize: 90, slotId: 'nt' })],
  };
  it('moves edited content into matching slots and keeps added elements', () => {
    const old = slide('s', [
      node('old-title', { type: 'text', text: 'My title', fontSize: 80, slotId: 'ot', edited: true, role: 'title' }),
      node('old-body', { type: 'text', text: 'My body', fontSize: 30, slotId: 'ob', edited: true, role: 'body', x: 7, y: 9 }),
      node('mine', { x: 1, y: 2 }),
    ], { notes: 'keep me' });
    const { slide: next, keptAsElements } = applyLayout(old, payload);
    expect(next.id).toBe('s');
    expect(next.notes).toBe('keep me');
    expect(next.nodes[0]).toMatchObject({ text: 'My title', slotId: 'nt', edited: true });
    expect(next.nodes.some((n) => n.id === 'mine')).toBe(true);
    // No body slot in the new layout: the edited body stays as a free element.
    expect(keptAsElements).toBe(1);
    const body = next.nodes.find((n) => n.text === 'My body')!;
    expect(body).toMatchObject({ x: 7, y: 9 });
    expect(body.slotId).toBeUndefined();
  });
});
