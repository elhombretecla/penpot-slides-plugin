import { describe, expect, it } from 'vitest';
import { isSvgMarkup, sanitizeSvg, scopeSvgIds, tagRenderNodes } from './svg';

const UUID = '11111111-2222-3333-4444-555555555555';

describe('sanitizeSvg', () => {
  it('removes scripts, event handlers and javascript: links', () => {
    const out = sanitizeSvg('<svg onload="x()"><script>alert(1)</script><a href="javascript:evil()"><rect onclick=\'y()\'/></a></svg>');
    expect(out).not.toMatch(/script|onload|onclick|javascript/);
    expect(out).toContain('<rect');
  });
});

describe('tagRenderNodes', () => {
  it('tags the groups of known shapes with their node id', () => {
    const out = tagRenderNodes(`<g id="shape-${UUID}"></g>`, { [UUID]: 'node-1' });
    expect(out).toContain('data-node="node-1"');
  });
});

describe('scopeSvgIds', () => {
  it('prefixes ids and every kind of reference to them', () => {
    const svg = '<svg><defs><clipPath id="c1"/></defs><g clip-path="url(#c1)" mask="url(&#x27;#c1&#x27;)"><use href="#c1" xlink:href="#c1"/><rect fill="url(#other)"/></g></svg>';
    const out = scopeSvgIds(svg, 's');
    expect(out).toContain('id="s-c1"');
    expect(out).toContain('url(#s-c1)');
    expect(out).toContain('url(&#x27;#s-c1&#x27;)');
    expect(out).toContain('href="#s-c1"');
    expect(out).toContain('xlink:href="#s-c1"');
    // Unknown ids are left alone.
    expect(out).toContain('url(#other)');
  });
});

describe('isSvgMarkup', () => {
  it('recognises markup', () => {
    expect(isSvgMarkup('  <svg></svg>')).toBe(true);
    expect(isSvgMarkup('data:image/png;base64,')).toBe(false);
    expect(isSvgMarkup(undefined)).toBe(false);
  });
});

describe('sanitizeSvg keeps content', () => {
  it('does not touch text that looks like an attribute', () => {
    const svg = '<svg><text x="1">Join onboard=yes today</text></svg>';
    expect(sanitizeSvg(svg)).toBe(svg);
  });
  it('removes unquoted handlers and embedded frames', () => {
    const out = sanitizeSvg('<svg><foreignObject><iframe src="x"></iframe></foreignObject><rect onmouseover=alert(1) width="2"/></svg>');
    expect(out).toBe('<svg><foreignObject></foreignObject><rect width="2"/></svg>');
  });
});
