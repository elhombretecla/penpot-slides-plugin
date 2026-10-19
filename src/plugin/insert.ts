import type { Slide, SlideNode, ExportSettings, DeckPlacement, PulledSlide, TemplateRef } from '../types';
import type { Board, Fill, Page, Shape, Text } from '@penpot/plugin-types';
import { DATA_NS } from './persistence';
import { allLibraries, findLibraryComponent } from './libraries';
import { removeQuietly } from './jobs';
import { importChildren, importShapeSafe } from './import';
import type { ImportContext } from './import';
import { readChildren, readBackground, readFillsSnapshot } from './media';
import { descendants, applySlideToInstance, populateNodes } from './slides';
import { clonePlain, stringifyErr, send, sendError, dedupe } from './util';

// ─── Canvas Insertion ─────────────────────────────────────────────────────────

const DECK_PADDING = 40;

export async function handleInsertIntoCanvas(
  deckId: string,
  deckName: string,
  slides: Slide[],
  settings: ExportSettings
) {
  const warnings: string[] = [];
  try {
    if (slides.length === 0) {
      send({ type: 'insert-complete', count: 0, warnings });
      return;
    }

    if (settings.mode === 'update') {
      const found = findDeckBoards(deckId);
      if (found) {
        await updateDeckInPlace(deckId, deckName, slides, settings, found.page, warnings);
        return;
      }
    }

    if (settings.createNewPage) {
      const page = penpot.createPage();
      page.name = deckName || 'Slides';
      // Shape creation always targets the active page.
      await penpot.openPage(page);
    }

    const gap = settings.spacing;
    const totalWidth = slides.reduce((sum, s, i) => sum + s.width + (i > 0 ? gap : 0), 0);
    const maxHeight = Math.max(...slides.map((s) => s.height));
    const center = penpot.viewport.center;

    const boards: Board[] = [];
    let deck: Board | null = null;

    if (settings.wrapInDeck) {
      deck = createDeck(totalWidth, maxHeight, gap, center);
    }

    let cursorX = center.x - totalWidth / 2;
    const topY = center.y - maxHeight / 2;

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const name = `${settings.slidePrefix} ${String(i + 1).padStart(2, '0')}`;
      const board = createBoardForSlide(slide, name);
      tagBoard(board, deckId, slide);

      if (deck) {
        // Flex assigns the real position; keep each slide at its own size.
        deck.appendChild(board);
        if (board.layoutChild) {
          board.layoutChild.horizontalSizing = 'fix';
          board.layoutChild.verticalSizing = 'fix';
        }
      } else {
        board.x = cursorX;
        board.y = topY;
        cursorX += slide.width + gap;
      }

      try {
        await populateSlide(board, slide, warnings);
      } catch (err) {
        warnings.push(`${name}: ${stringifyErr(err)}`);
      }
      boards.push(board);
    }

    if (settings.createFlow && !deck && boards.length > 0) {
      try {
        const page = penpot.currentPage;
        if (page) {
          const flowName = deckName || 'Presentation';
          // Re-inserting the same deck replaces its flow instead of piling up.
          page.flows.filter((f) => f.name === flowName).forEach((f) => page.removeFlow(f));
          page.createFlow(flowName, boards[0]);
        }
      } catch (err) {
        warnings.push(`Could not create the presentation flow: ${stringifyErr(err)}`);
      }
    }

    try {
      penpot.selection = deck ? [deck] : boards;
    } catch {
      // Selection is cosmetic; ignore if unavailable.
    }

    send({ type: 'insert-complete', count: boards.length, warnings: dedupe(warnings) });
  } catch (err) {
    sendError('Failed to insert slides: ' + stringifyErr(err));
  }
}

// ─── Inserted decks (update in place, read back) ─────────────────────────────

interface DeckBoard {
  board: Board;
  slideId: string;
}

function slideTagOf(shape: Shape): { deckId: string; slideId: string } | null {
  try {
    const raw = shape.getSharedPluginData(DATA_NS, 'slide');
    const tag = raw ? JSON.parse(raw) : null;
    return tag && typeof tag.deckId === 'string' && typeof tag.slideId === 'string' ? tag : null;
  } catch {
    return null;
  }
}

// Top-level slide boards, or inside one wrapper board ("Slides deck").
function deckBoardsOn(page: Page, deckId: string): DeckBoard[] {
  const out: DeckBoard[] = [];
  const scan = (parent: Shape, depth: number) => {
    for (const child of readChildren(parent)) {
      if (child.type !== 'board') continue;
      const tag = slideTagOf(child);
      if (tag) {
        if (tag.deckId === deckId) out.push({ board: child as Board, slideId: tag.slideId });
      } else if (depth === 0) {
        scan(child, 1);
      }
    }
  };
  if (page.root) scan(page.root, 0);
  return out;
}

// The page holding most of the deck's boards.
function findDeckBoards(deckId: string): { page: Page; boards: DeckBoard[] } | null {
  let best: { page: Page; boards: DeckBoard[] } | null = null;
  for (const page of penpot.currentFile?.pages ?? []) {
    const boards = deckBoardsOn(page, deckId);
    if (boards.length > 0 && (!best || boards.length > best.boards.length)) best = { page, boards };
  }
  return best;
}

export function findDeckPlacement(deckId: string): DeckPlacement | null {
  try {
    const found = findDeckBoards(deckId);
    return found ? { deckId, pageId: found.page.id, pageName: found.page.name, count: found.boards.length } : null;
  } catch {
    return null;
  }
}

// Each slide's board is rebuilt where the previous one was (same parent,
// position and name); new slides go to the right of the row, boards of
// slides deleted from the deck are removed.
async function updateDeckInPlace(
  deckId: string,
  deckName: string,
  slides: Slide[],
  settings: ExportSettings,
  page: Page,
  warnings: string[]
) {
  if (penpot.currentPage?.id !== page.id) await penpot.openPage(page);
  const current = penpot.currentPage ?? page;
  const existing = deckBoardsOn(current, deckId);
  const bySlide = new Map(existing.map((b) => [b.slideId, b.board]));
  const rootId = current.root?.id;
  const wrapper = existing
    .map((b) => b.board.parent)
    .find((p): p is Board => !!p && p.id !== rootId && p.type === 'board');

  const topLevel = existing.filter((b) => b.board.parent?.id === rootId).map((b) => b.board);
  let nextX = topLevel.length > 0 ? Math.max(...topLevel.map((b) => b.x + b.width)) + settings.spacing : penpot.viewport.center.x;
  const rowY = topLevel.length > 0 ? Math.min(...topLevel.map((b) => b.y)) : penpot.viewport.center.y;

  const boards: Board[] = [];
  let updated = 0;
  let added = 0;
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const old = bySlide.get(slide.id);
    bySlide.delete(slide.id);
    const name = old?.name ?? `${settings.slidePrefix} ${String(i + 1).padStart(2, '0')}`;
    const board = createBoardForSlide(slide, name);
    tagBoard(board, deckId, slide);

    const parent = old?.parent;
    if (old && parent && parent.id !== rootId && parent.type === 'board') {
      (parent as Board).insertChild(old.parentIndex, board);
    } else if (old) {
      board.x = old.x;
      board.y = old.y;
    } else if (wrapper) {
      wrapper.appendChild(board);
    } else {
      board.x = nextX;
      board.y = rowY;
      nextX += slide.width + settings.spacing;
    }
    if (board.layoutChild) {
      board.layoutChild.horizontalSizing = 'fix';
      board.layoutChild.verticalSizing = 'fix';
    }

    try {
      await populateSlide(board, slide, warnings);
    } catch (err) {
      warnings.push(`${name}: ${stringifyErr(err)}`);
    }
    if (old) {
      removeQuietly(old);
      updated++;
    } else {
      added++;
    }
    boards.push(board);
  }

  let removed = 0;
  for (const old of bySlide.values()) {
    removeQuietly(old);
    removed++;
  }

  // The previous boards (and the flow pointing at the first one) are gone.
  if (settings.createFlow && !wrapper && boards.length > 0) {
    try {
      const flowName = deckName || 'Presentation';
      current.flows.filter((f) => f.name === flowName).forEach((f) => current.removeFlow(f));
      current.createFlow(flowName, boards[0]);
    } catch (err) {
      warnings.push(`Could not update the presentation flow: ${stringifyErr(err)}`);
    }
  }

  try {
    penpot.selection = boards;
  } catch {
    // Selection is cosmetic.
  }
  send({
    type: 'insert-complete',
    count: boards.length,
    warnings: dedupe(warnings),
    updated,
    added,
    removed,
    pageName: current.name,
  });
}

function isCopyOf(shape: Shape, componentId: string): boolean {
  try {
    return shape.isComponentCopyInstance() && shape.component()?.id === componentId;
  } catch {
    return false;
  }
}

function stripSlots(node: SlideNode): SlideNode {
  const rest: SlideNode = { ...node };
  delete rest.slotId;
  delete rest.edited;
  return rest.children ? { ...rest, children: rest.children.map(stripSlots) } : rest;
}

// Flag template content that was changed on the canvas, as the editor does.
function markOverridden(nodes: SlideNode[], copy: Shape) {
  const refs = new Map<string, Shape>();
  for (const shape of descendants(copy)) {
    try {
      const ref = shape.componentRefShape();
      if (ref) refs.set(shape.id, ref);
    } catch {
      // Not template content.
    }
  }
  const imageId = (fills: unknown) =>
    Array.isArray(fills) ? (fills as Fill[]).find((f) => f.fillImage)?.fillImage?.id : undefined;
  const visit = (list: SlideNode[]) => {
    for (const node of list) {
      const ref = refs.get(node.id);
      if (ref) {
        if (node.type === 'text' && ref.type === 'text' && (ref as Text).characters !== node.text) node.edited = true;
        const own = imageId(node.fills);
        if (own && own !== imageId(ref.fills)) {
          node.imageReplaced = true;
          node.edited = true;
        }
      }
      if (node.children) visit(node.children);
    }
  };
  visit(nodes);
}

export async function handlePullDeck(requestId: string, deckId: string, templates: Record<string, TemplateRef | null>) {
  const warnings: string[] = [];
  try {
    const found = findDeckBoards(deckId);
    if (!found) throw new Error('This presentation is not on any page of the file.');
    const slides: PulledSlide[] = [];
    for (const { board, slideId } of found.boards) {
      if (!(slideId in templates)) continue; // slide deleted from the deck since
      const template = templates[slideId];
      const lib = template ? findLibraryComponent(template.libraryId, template.componentId)?.lib : null;
      const ctx: ImportContext = {
        rootComponentId: template?.componentId ?? '',
        warnings,
        typographies: lib ? [...lib.typographies] : allLibraries().flatMap((l) => l.typographies),
      };
      const nodes: SlideNode[] = [];
      let backgroundShape: Shape = board;
      for (const child of readChildren(board)) {
        if (template && isCopyOf(child, template.componentId)) {
          backgroundShape = child;
          const inner = await importChildren(readChildren(child), board.x, board.y, ctx);
          markOverridden(inner, child);
          nodes.push(...inner);
        } else {
          const node = await importShapeSafe(child, board.x, board.y, ctx);
          if (node) nodes.push(stripSlots(node));
        }
      }
      let notes: string | undefined;
      try {
        notes = board.getSharedPluginData(DATA_NS, 'notes') || undefined;
      } catch {
        notes = undefined;
      }
      slides.push({
        slideId,
        nodes,
        background: readBackground(backgroundShape) ?? '#ffffff',
        backgroundFills: readFillsSnapshot(backgroundShape),
        notes,
      });
    }
    send({ type: 'deck-pulled', requestId, deckId, slides, warnings: dedupe(warnings) });
  } catch (err) {
    send({ type: 'deck-pulled', requestId, deckId, slides: [], warnings, message: stringifyErr(err) });
  }
}

function createDeck(totalWidth: number, maxHeight: number, gap: number, center: { x: number; y: number }): Board {
  const deckWidth = totalWidth + DECK_PADDING * 2;
  const deckHeight = maxHeight + DECK_PADDING * 2;

  const deck = penpot.createBoard();
  deck.name = 'Slides deck';
  deck.x = center.x - deckWidth / 2;
  deck.y = center.y - deckHeight / 2;
  deck.resize(deckWidth, deckHeight);
  // Transparent wrapper that hugs its content and never clips the slides.
  deck.fills = [];
  deck.horizontalSizing = 'auto';
  deck.clipContent = false;

  const flex = deck.addFlexLayout();
  flex.dir = 'row';
  flex.wrap = 'nowrap';
  flex.alignItems = 'start';
  flex.justifyContent = 'start';
  flex.topPadding = DECK_PADDING;
  flex.rightPadding = DECK_PADDING;
  flex.bottomPadding = DECK_PADDING;
  flex.leftPadding = DECK_PADDING;
  flex.rowGap = gap;
  flex.columnGap = gap;
  return deck;
}

// Inserted boards remember which deck/slide they come from (groundwork for
// updating them in place) and carry the speaker notes.
function tagBoard(board: Board, deckId: string, slide: Slide) {
  try {
    board.setSharedPluginData(
      DATA_NS,
      'slide',
      JSON.stringify({ deckId, slideId: slide.id, componentId: slide.template?.componentId ?? null })
    );
    if (slide.notes) board.setSharedPluginData(DATA_NS, 'notes', slide.notes);
  } catch {
    // Tags are an optional extra; the slide itself is already inserted.
  }
}

export function createBoardForSlide(slide: Slide, name: string): Board {
  const board = penpot.createBoard();
  board.name = name;
  board.resize(slide.width, slide.height);
  board.clipContent = true;

  // Full fills snapshot first (gradients, images, linked library colors);
  // the flat hex is only for slides created from scratch.
  board.fills =
    slide.backgroundFills && slide.backgroundFills.length > 0
      ? (clonePlain(slide.backgroundFills) as Fill[])
      : [{ fillColor: slide.background, fillOpacity: 1 }];
  return board;
}

export async function populateSlide(
  board: Board,
  slide: Slide,
  warnings: string[],
  track?: Map<string, string>
) {
  // Template slides are a linked copy of the template plus the slide's
  // changes as overrides; elements the user added go on top of it (a copy's
  // structure can't change).
  if (slide.template) {
    const found = findLibraryComponent(slide.template.libraryId, slide.template.componentId);
    if (found) {
      const instance = found.comp.instance();
      board.appendChild(instance);
      instance.x = board.x;
      instance.y = board.y;
      const free = slide.nodes.length > 0 ? await applySlideToInstance(instance, slide, warnings, track) : [];
      const created = await populateNodes(board, free, board.x, board.y, warnings, track);
      pinStacking([instance, ...created]);
      return;
    }
    if (slide.nodes.length === 0) {
      warnings.push(`"${slide.name}": template component not found — the slide is empty.`);
      return;
    }
    warnings.push(`"${slide.name}": template "${slide.template.componentName}" not found — inserted as a detached copy.`);
  }

  // SlideNode coordinates are slide-relative; Penpot coordinates are
  // absolute, so offset by the board's (post-layout) position.
  pinStacking(await populateNodes(board, slide.nodes, board.x, board.y, warnings, track));
}

// appendChild normally stacks in call order, but with slow steps in between
// (image uploads) Penpot has been seen placing a shape at the bottom. Pin the
// final order explicitly: `ordered` is bottom → top.
function pinStacking(ordered: Shape[]) {
  ordered.forEach((shape, index) => {
    try {
      if (shape.parentIndex !== index) shape.setParentIndex(index);
    } catch {
      // Order is best effort; the content is there.
    }
  });
}
