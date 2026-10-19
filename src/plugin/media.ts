import type { Fill, ImageData, Shape } from '@penpot/plugin-types';
import { markScratch } from './jobs';
import { clonePlain, uint8ArrayToBase64 } from './util';

// ─── Media inlining ──────────────────────────────────────────────────────────
// Markup references images by authenticated asset URLs that the plugin UI
// cannot load. The bytes are reachable through `ImageData.data()`: a
// throw-away rectangle gets an image fill with the media id and is read back
// (~40 ms per image, cached for the session).

const MEDIA_URL_RE = /https?:\/\/[^"'\s)]*\/assets\/by-file-media-id\/([0-9a-f-]{36})/g;
const mediaCache = new Map<string, string | null>();

export function hasMedia(svg: string): boolean {
  return svg.includes('by-file-media-id');
}

export function firstMedia(svg: string): ImageData | null {
  const m = /by-file-media-id\/([0-9a-f-]{36})/.exec(svg);
  if (!m) return null;
  const tag = new RegExp(`<image[^>]*${m[1]}[^>]*>`).exec(svg)?.[0] ?? '';
  // Penpot only accepts integer image sizes in fills.
  const num = (attr: string) =>
    Math.max(1, Math.round(parseFloat(new RegExp(`\\b${attr}="([0-9.]+)"`).exec(tag)?.[1] ?? '') || 100));
  return { id: m[1], width: num('width'), height: num('height'), mtype: 'image/png', keepAspectRatio: false } as unknown as ImageData;
}

function sniffMime(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[8] === 0x57) return 'image/webp';
  if (bytes[0] === 0x3c) return 'image/svg+xml';
  return 'image/png';
}

async function mediaDataUrl(id: string): Promise<string | null> {
  if (mediaCache.has(id)) return mediaCache.get(id) ?? null;
  let result: string | null = null;
  let probe: Shape | null = null;
  try {
    probe = markScratch(penpot.createRectangle());
    probe.x = -100000;
    probe.y = -100000;
    probe.fills = [{ fillOpacity: 1, fillImage: { id, width: 1, height: 1, mtype: 'image/png', keepAspectRatio: false } as unknown as ImageData }];
    const image = Array.isArray(probe.fills) ? probe.fills[0]?.fillImage : undefined;
    if (image) {
      const bytes = await image.data();
      result = `data:${sniffMime(bytes)};base64,${uint8ArrayToBase64(bytes)}`;
    }
  } catch {
    result = null;
  } finally {
    try {
      probe?.remove();
    } catch {
      // Nothing else to clean up.
    }
  }
  mediaCache.set(id, result);
  return result;
}

// The markup with every asset URL replaced by a data URL, or undefined when
// some image could not be read (`loose` keeps the unreadable ones instead).
export async function inlineMedia(svg: string, loose = false): Promise<string | undefined> {
  if (!hasMedia(svg)) return svg;
  const ids = [...new Set([...svg.matchAll(MEDIA_URL_RE)].map((m) => m[1]))];
  const urls = new Map<string, string>();
  for (const id of ids) {
    const url = await mediaDataUrl(id);
    if (url) urls.set(id, url);
    else if (!loose) return undefined;
  }
  return svg.replace(MEDIA_URL_RE, (_match, id: string) => urls.get(id) ?? _match);
}

export async function imageFillDataUrl(fills: Fill[]): Promise<string | undefined> {
  const image = fills.find((f) => f.fillImage)?.fillImage;
  if (!image) return undefined;
  try {
    const bytes = await image.data();
    return `data:${image.mtype || 'image/png'};base64,${uint8ArrayToBase64(bytes)}`;
  } catch {
    return undefined;
  }
}

// Server-side raster export — slow (seconds), used only as a fallback.
export async function safeExportPng(shape: Shape, scale: number): Promise<string | undefined> {
  try {
    const bytes = await shape.export({ type: 'png', scale });
    return `data:image/png;base64,${uint8ArrayToBase64(bytes)}`;
  } catch {
    return undefined;
  }
}

export function readChildren(shape: Shape): Shape[] {
  try {
    return 'children' in shape && Array.isArray(shape.children) ? shape.children : [];
  } catch {
    // Accessing `.children` may throw on certain shapes; treat as leaf.
    return [];
  }
}

export function readBackground(shape: Shape): string | null {
  try {
    const fills = shape.fills;
    if (Array.isArray(fills) && typeof fills[0]?.fillColor === 'string') return fills[0].fillColor;
  } catch {
    // Unreadable fills → caller uses its default background.
  }
  return null;
}

export function readFillsSnapshot(shape: Shape): unknown[] | undefined {
  try {
    const fills = shape.fills;
    if (Array.isArray(fills) && fills.length > 0) return clonePlain(fills);
  } catch {
    // Unreadable fills → no snapshot, the flat background is used.
  }
  return undefined;
}
