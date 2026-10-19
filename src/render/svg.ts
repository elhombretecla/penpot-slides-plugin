import { ensureFontLoaded } from '../utils';

// Helpers to display Penpot markup inline. Inline (not <img>) so the SVG
// uses the fonts loaded in the document, like the editor's HTML text.

// The markup is Penpot's own rendering, but it carries user content and is
// inserted as live DOM: drop active elements, event handlers and script
// URLs. Attributes are only touched inside tags, never in text content.
const ACTIVE_ELEMENT_RE = /<(script|iframe|object|embed)\b[\s\S]*?(?:<\/\1\s*>|\/>)/gi;
const TAG_RE = /<[A-Za-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g;
const EVENT_ATTR_RE = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const SCRIPT_URL_RE = /((?:xlink:)?href\s*=\s*["'])\s*javascript:[^"']*/gi;

export function sanitizeSvg(svg: string): string {
  return svg
    .replace(ACTIVE_ELEMENT_RE, '')
    .replace(TAG_RE, (tag) => tag.replace(EVENT_ATTR_RE, '').replace(SCRIPT_URL_RE, '$1#'));
}

// Tag the group of each top-level shape with the node it was built from.
export function tagRenderNodes(svg: string, shapes: Record<string, string>): string {
  return svg.replace(/id="shape-([0-9a-f-]{36})"/g, (match, id: string) =>
    shapes[id] ? `${match} data-node="${shapes[id]}"` : match
  );
}

// Several copies of the same markup can be on screen (canvas and slide
// list): prefix ids so url(#…) references resolve inside each copy.
export function scopeSvgIds(svg: string, scope: string): string {
  const ids = new Set<string>();
  for (const m of svg.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  if (ids.size === 0) return svg;
  const fix = (id: string) => (ids.has(id) ? `${scope}-${id}` : id);
  return svg
    .replace(/\bid="([^"]+)"/g, (_m, id: string) => `id="${fix(id)}"`)
    // Penpot writes both url(#id) and url(&#x27;#id&#x27;).
    .replace(/url\((&#x27;|'|")?#([^)'"&]+)(&#x27;|'|")?\)/g, (_m, q1 = '', id: string, q2 = '') =>
      `url(${q1}#${fix(id)}${q2})`
    )
    .replace(/((?:xlink:)?href)="#([^"]+)"/g, (_m, attr: string, id: string) => `${attr}="#${fix(id)}"`);
}

export function loadSvgFonts(svg: string) {
  for (const m of svg.matchAll(/font-family:\s*([^;"]+)/g)) {
    ensureFontLoaded(m[1].trim().replace(/^['"]|['"]$/g, ''));
  }
}

// Downscale embedded raster images to what a preview can show: renders carry
// the original pictures (often several MB) and are cached and kept in memory.
const DATA_IMAGE_RE = /(href=")(data:image\/(?:png|jpeg|webp|gif);base64,[^"]+)(")/g;
const COMPACT_MIN_LENGTH = 60_000;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function downscale(dataUrl: string, maxDim: number): Promise<string> {
  const img = await loadImage(dataUrl);
  if (!img || !img.naturalWidth) return dataUrl;
  const ratio = maxDim / Math.max(img.naturalWidth, img.naturalHeight);
  if (ratio >= 1) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  // PNG may carry transparency; photos are fine as JPEG.
  const out = dataUrl.startsWith('data:image/jpeg')
    ? canvas.toDataURL('image/jpeg', 0.86)
    : canvas.toDataURL('image/png');
  return out.length < dataUrl.length ? out : dataUrl;
}

export async function compactSvgImages(svg: string, maxDim: number): Promise<string> {
  const big = [...new Set([...svg.matchAll(DATA_IMAGE_RE)].map((m) => m[2]))].filter(
    (url) => url.length > COMPACT_MIN_LENGTH
  );
  if (big.length === 0) return svg;
  const replaced = new Map<string, string>();
  for (const url of big) {
    try {
      replaced.set(url, await downscale(url, maxDim));
    } catch {
      // Keep the original picture.
    }
  }
  return svg.replace(DATA_IMAGE_RE, (m, pre: string, url: string, post: string) =>
    replaced.has(url) ? pre + replaced.get(url) + post : m
  );
}

// Plugin output → markup ready to store and display.
export async function prepareSvg(
  svg: string,
  maxImageDim: number,
  shapes?: Record<string, string>
): Promise<string> {
  let out = sanitizeSvg(svg);
  if (shapes) out = tagRenderNodes(out, shapes);
  return compactSvgImages(out, maxImageDim);
}

export function isSvgMarkup(value: string | undefined | null): value is string {
  return !!value && value.trimStart().startsWith('<svg');
}
