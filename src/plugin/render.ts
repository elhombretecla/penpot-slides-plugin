import type { Slide, SlideNode } from '../types';
import type { LibraryComponent, Shape, Text } from '@penpot/plugin-types';
import { findLibrary, findLibraryComponent } from './libraries';
import { SCRATCH_X, SCRATCH_Y, exclusive, withUndoBlock, removeQuietly, markScratch } from './jobs';
import { safeMarkup, stableMarkup, svgDataUrl } from './markup';
import { inlineMedia, safeExportPng, readChildren } from './media';
import { createBoardForSlide, populateSlide } from './insert';
import { stringifyErr, send, hashString } from './util';

// ─── Render engine ───────────────────────────────────────────────────────────
// Previews are Penpot's own rendering: the slide (or component) is built
// off-canvas on the current page with the same code as "Insert", rendered
// with generateMarkup (client-side, ~60 ms) and removed.

// Thumbnails are Penpot's own client-side SVG of a temporary instance (the
// main component lives on another page, where text is not rendered). The job
// is cancellable — a newer request supersedes the running one — and
// signature-checked: the UI caches thumbnails across sessions and only
// changed components are re-rendered.
const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_BATCH = 4;
let activeThumbnailRequest: string | null = null;

export async function handleGetThumbnails(
  requestId: string,
  libraryId: string,
  known: Record<string, string>,
  force: boolean
) {
  activeThumbnailRequest = requestId;
  const current = () => activeThumbnailRequest === requestId;
  try {
    const lib = findLibrary(libraryId);
    if (!lib) return;

    const todo: { comp: LibraryComponent; main: Shape; signature: string }[] = [];
    for (const comp of lib.components) {
      if (!current()) return;
      try {
        const main = comp.mainInstance();
        if (!main) continue;
        const signature = componentSignature(main);
        if (!force && known[comp.id] === signature) continue;
        todo.push({ comp, main, signature });
      } catch {
        // Unreadable component: the card shows a placeholder.
      }
    }

    for (let i = 0; i < todo.length && current(); i += THUMBNAIL_BATCH) {
      const batch = todo.slice(i, i + THUMBNAIL_BATCH);
      const rendered = await exclusive(() => withUndoBlock(() => renderComponents(batch.map((b) => b.comp))));
      for (let j = 0; j < batch.length && current(); j++) {
        const { comp, main, signature } = batch[j];
        // The server exporter (seconds) is only a last resort.
        const thumbnail =
          rendered[j] ?? (await safeExportPng(main, Math.min(1, THUMBNAIL_WIDTH / Math.max(1, main.width))));
        if (!thumbnail || !current()) continue;
        send({ type: 'thumbnail', requestId, componentId: comp.id, thumbnail, signature });
      }
    }
  } finally {
    if (current()) send({ type: 'thumbnails-complete', requestId });
  }
}

// Cheap content fingerprint of a main component: its client-side SVG markup
// (~50 ms) plus size. Text is not part of the markup for shapes on other
// pages, so pure text edits need a manual refresh.
function componentSignature(main: Shape): string {
  const markup = safeMarkup(main) ?? '';
  return `${Math.round(main.width)}x${Math.round(main.height)}:${hashString(markup)}`;
}

// A library element (logo, icon…) as a single linked component-instance node.
export async function handleGetAsset(requestId: string, libraryId: string, componentId: string) {
  try {
    const found = findLibraryComponent(libraryId, componentId);
    if (!found) throw new Error('Component not found in the library.');
    const main = found.comp.mainInstance();
    const [svgMarkup] = await exclusive(() => withUndoBlock(() => renderComponents([found.comp])));
    const node: SlideNode = {
      id: `${componentId}-asset`,
      type: 'component-instance',
      name: found.comp.name,
      x: 0,
      y: 0,
      width: main.width,
      height: main.height,
      visible: true,
      opacity: 1,
      rotation: 0,
      role: 'asset',
      libraryId: found.lib.id,
      componentId,
      componentName: found.comp.name,
      svgMarkup,
      imageUrl: svgMarkup ? svgDataUrl(svgMarkup) : await safeExportPng(main, 1),
    };
    send({ type: 'asset', requestId, node });
  } catch (err) {
    send({ type: 'asset', requestId, node: null, message: stringifyErr(err) });
  }
}



// Text layout is asynchronous: freshly created or edited texts reach the
// markup up to ~1 s later. Poll until every visible text shows a word of its
// content and two consecutive renders agree.
const SETTLE_MIN_MS = 150;
const SETTLE_MAX_MS = 3000;
const SETTLE_POLL_MS = 120;

function textProbes(root: Shape): string[] {
  const probes: string[] = [];
  const visit = (shape: Shape) => {
    if (shape.hidden) return;
    if (shape.type === 'text') {
      const word = /[A-Za-z0-9]{2,10}/.exec((shape as Text).characters ?? '')?.[0];
      if (word) probes.push(word);
      return;
    }
    readChildren(shape).forEach(visit);
  };
  visit(root);
  return probes;
}

async function settledMarkup(shape: Shape): Promise<string | undefined> {
  const probes = textProbes(shape);
  const started = Date.now();
  let previous: string | undefined;
  for (;;) {
    const markup = safeMarkup(shape);
    const elapsed = Date.now() - started;
    const complete = markup !== undefined && probes.every((p) => markup.includes(p));
    const stable = markup !== undefined && stableMarkup(markup) === previous;
    if ((complete && stable && elapsed >= SETTLE_MIN_MS) || elapsed >= SETTLE_MAX_MS) {
      return markup;
    }
    previous = markup === undefined ? undefined : stableMarkup(markup);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
}

// Markup of temporary instances of each component (media inlined; an
// unreadable picture is left as is rather than failing the preview).
async function renderComponents(comps: LibraryComponent[]): Promise<(string | undefined)[]> {
  const instances: Shape[] = [];
  try {
    comps.forEach((comp, i) => {
      const instance = markScratch(comp.instance());
      instance.x = SCRATCH_X;
      instance.y = SCRATCH_Y + i * 5000;
      instances.push(instance);
    });
    const out: (string | undefined)[] = [];
    for (const instance of instances) {
      const raw = await settledMarkup(instance);
      out.push(raw ? await inlineMedia(raw, true) : undefined);
    }
    return out;
  } catch {
    return comps.map(() => undefined);
  } finally {
    instances.forEach(removeQuietly);
  }
}

export async function handleRenderSlide(requestId: string, slide: Slide) {
  try {
    const result = await exclusive(() =>
      withUndoBlock(async () => {
        const track = new Map<string, string>();
        const board = markScratch(createBoardForSlide(slide, `Slide preview · ${slide.name}`));
        try {
          board.x = SCRATCH_X;
          board.y = SCRATCH_Y;
          await populateSlide(board, slide, [], track);
          const raw = await settledMarkup(board);
          if (!raw) throw new Error('Penpot returned no markup for the slide.');
          return { svg: (await inlineMedia(raw, true)) ?? raw, shapes: Object.fromEntries(track) };
        } finally {
          removeQuietly(board);
        }
      })
    );
    send({ type: 'slide-render', requestId, slideId: slide.id, ...result });
  } catch (err) {
    send({ type: 'slide-render', requestId, slideId: slide.id, svg: null, shapes: {}, message: stringifyErr(err) });
  }
}
