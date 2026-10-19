import { describe, expect, it } from 'vitest';
import { onlyRootTree, stableMarkup, svgDataUrl } from './markup';

const ROOT = 'aaaaaaaa-0000-0000-0000-000000000001';
const CHILD = 'aaaaaaaa-0000-0000-0000-000000000002';

describe('onlyRootTree', () => {
  // generateMarkup repeats every descendant as an extra top-level group.
  const svg =
    `<svg><g id="shape-${ROOT}"><g id="shape-${CHILD}"><rect/></g></g>` +
    `<g id="shape-${CHILD}"><rect/></g></svg>`;

  it('keeps the root tree and drops the repeated top-level groups', () => {
    const out = onlyRootTree(svg, ROOT);
    expect(out.match(new RegExp(`shape-${CHILD}`, 'g'))).toHaveLength(1);
    expect(out).toContain(`shape-${ROOT}`);
    expect(out.endsWith('</svg>')).toBe(true);
  });
  it('returns the markup untouched when the root is not there', () => {
    expect(onlyRootTree(svg, 'bbbbbbbb-0000-0000-0000-000000000000')).toBe(svg);
  });
  it('handles self-closing tags and quoted ">" in attributes', () => {
    const tricky = `<svg><g id="shape-${ROOT}"><text data-x="a>b">t</text><path d="M0 0"/></g><g id="shape-${CHILD}"/></svg>`;
    expect(onlyRootTree(tricky, ROOT)).not.toContain(CHILD);
  });
});

describe('stableMarkup', () => {
  it('ignores render counters and generated uuids', () => {
    const a = `<defs id="render-12"><g id="stroke-${ROOT}"/></defs>`;
    const b = `<defs id="render-99"><g id="stroke-${CHILD}"/></defs>`;
    expect(stableMarkup(a)).toBe(stableMarkup(b));
  });
});

describe('svgDataUrl', () => {
  it('percent-encodes the markup', () => {
    expect(svgDataUrl('<svg a="#"/>')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%22%23%22%2F%3E');
  });
});
