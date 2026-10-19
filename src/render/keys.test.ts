import { describe, expect, it } from 'vitest';
import { frameSignature, hashString, nodeSignature, slideRenderKey } from './keys';
import { node, slide } from '../test/factories';

describe('render keys', () => {
  it('hashString is stable and length-aware', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
  it('node signatures change with content only', () => {
    const n = node('a');
    expect(nodeSignature(n)).toBe(nodeSignature({ ...n }));
    expect(nodeSignature({ ...n, x: 1 })).not.toBe(nodeSignature(n));
  });
  it('renaming a slide or editing its notes keeps the render', () => {
    const s = slide('s', [node('a')]);
    expect(slideRenderKey({ ...s, name: 'Other', notes: 'hi' })).toBe(slideRenderKey(s));
    expect(slideRenderKey({ ...s, background: '#000000' })).not.toBe(slideRenderKey(s));
  });
  it('a template slide without nodes is keyed by its component', () => {
    const s = slide('s', [], { template: { libraryId: 'l', componentId: 'c1', componentName: 'x' } });
    const t = { ...s, template: { ...s.template!, componentId: 'c2' } };
    expect(frameSignature(t)).not.toBe(frameSignature(s));
  });
});
