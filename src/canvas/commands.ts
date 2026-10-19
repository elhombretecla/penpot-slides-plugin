import { useCallback, useEffect, useRef } from 'react';
import { useSlideStore, type StackDirection } from '../store';
import type { Slide, SlideNode } from '../types';
import { findNodeAbs, findNodeById } from '../utils';
import { cloneNodeWithNewIds } from '../deck';

// Distance (in slide units) a paste or a duplicate shifts so the copy is
// visible instead of stacking exactly on top of the original.
export const PASTE_OFFSET = 20;

// Drop selected ids whose ancestor is also selected — a child already comes
// along with its parent when copying or moving.
export function dropDominatedIds(nodes: SlideNode[], ids: string[]): string[] {
  const selected = new Set(ids);
  const dominated = new Set<string>();
  const visit = (ns: SlideNode[], parentSelected: boolean) => {
    for (const n of ns) {
      const isSel = selected.has(n.id);
      if (isSel && parentSelected) dominated.add(n.id);
      if (n.children) visit(n.children, isSel || parentSelected);
    }
  };
  visit(nodes, false);
  return ids.filter((id) => !dominated.has(id));
}

interface ClipItem {
  node: SlideNode;
  absX: number;
  absY: number;
}

// Copies of nodes as free top-level elements at their absolute position: a
// copy is a new element, never another instance of a template slot (Penpot
// cannot add children inside a linked template copy).
export function freeCopies(slide: Slide, ids: string[]): ClipItem[] {
  const out: ClipItem[] = [];
  for (const id of dropDominatedIds(slide.nodes, ids)) {
    const found = findNodeAbs(slide.nodes, id);
    if (!found) continue;
    out.push({ node: cloneNodeWithNewIds(found.node, false), absX: found.absX, absY: found.absY });
  }
  return out;
}

export interface CanvasCommands {
  canPaste: () => boolean;
  copy: () => void;
  cut: () => void;
  paste: (at?: { x: number; y: number } | null) => void;
  duplicate: () => void;
  remove: () => void;
  selectAll: () => void;
  nudge: (dx: number, dy: number) => void;
  arrange: (direction: StackDirection) => void;
  editText: () => void;
}

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable;
}

// Editing commands of the canvas (shared by keyboard shortcuts and the
// context menu). Each command is one undo step.
export function useCanvasCommands(
  slide: Slide | null,
  editingNodeId: string | null,
  startEditing: (id: string) => void,
  mouseSlidePosRef: React.MutableRefObject<{ x: number; y: number } | null>
): CanvasCommands {
  const clipboardRef = useRef<ClipItem[]>([]);
  // How many times the current clipboard was pasted without a pointer
  // position: each paste shifts one more step.
  const pasteCountRef = useRef(0);

  const selectedNodeIds = useSlideStore((s) => s.selectedNodeIds);
  const setSelectedNodes = useSlideStore((s) => s.setSelectedNodes);
  const addNode = useSlideStore((s) => s.addNode);
  const deleteNode = useSlideStore((s) => s.deleteNode);
  const moveNodes = useSlideStore((s) => s.moveNodes);
  const reorderNode = useSlideStore((s) => s.reorderNode);
  const commitHistory = useSlideStore((s) => s.commitHistory);
  const commitHistoryCoalesced = useSlideStore((s) => s.commitHistoryCoalesced);

  const copy = useCallback(() => {
    if (!slide || selectedNodeIds.length === 0) return;
    clipboardRef.current = freeCopies(slide, selectedNodeIds);
    pasteCountRef.current = 0;
  }, [slide, selectedNodeIds]);

  const remove = useCallback(() => {
    if (!slide || selectedNodeIds.length === 0) return;
    commitHistory();
    for (const id of selectedNodeIds) deleteNode(slide.id, id);
    setSelectedNodes([]);
  }, [slide, selectedNodeIds, commitHistory, deleteNode, setSelectedNodes]);

  const cut = useCallback(() => {
    copy();
    remove();
  }, [copy, remove]);

  // Pastes land on top of the stack: centred on the pointer when it is over
  // the slide (or on `at`), otherwise shifted from the source.
  const paste = useCallback(
    (at?: { x: number; y: number } | null) => {
      const items = clipboardRef.current;
      if (!slide || items.length === 0) return;
      const anchor = at ?? mouseSlidePosRef.current;
      let dx: number;
      let dy: number;
      if (anchor) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const it of items) {
          minX = Math.min(minX, it.absX);
          minY = Math.min(minY, it.absY);
          maxX = Math.max(maxX, it.absX + it.node.width);
          maxY = Math.max(maxY, it.absY + it.node.height);
        }
        dx = anchor.x - (minX + maxX) / 2;
        dy = anchor.y - (minY + maxY) / 2;
      } else {
        pasteCountRef.current += 1;
        dx = dy = PASTE_OFFSET * pasteCountRef.current;
      }
      commitHistory();
      const ids: string[] = [];
      for (const it of items) {
        const fresh = cloneNodeWithNewIds(it.node, false);
        fresh.x = it.absX + dx;
        fresh.y = it.absY + dy;
        addNode(slide.id, fresh);
        ids.push(fresh.id);
      }
      setSelectedNodes(ids);
    },
    [slide, mouseSlidePosRef, commitHistory, addNode, setSelectedNodes]
  );

  const duplicate = useCallback(() => {
    if (!slide || selectedNodeIds.length === 0) return;
    commitHistory();
    const ids: string[] = [];
    for (const it of freeCopies(slide, selectedNodeIds)) {
      it.node.x = it.absX + PASTE_OFFSET;
      it.node.y = it.absY + PASTE_OFFSET;
      addNode(slide.id, it.node);
      ids.push(it.node.id);
    }
    setSelectedNodes(ids);
  }, [slide, selectedNodeIds, commitHistory, addNode, setSelectedNodes]);

  const selectAll = useCallback(() => {
    if (!slide) return;
    setSelectedNodes(slide.nodes.filter((n) => n.visible).map((n) => n.id));
  }, [slide, setSelectedNodes]);

  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (!slide || selectedNodeIds.length === 0) return;
      // A run of arrow presses is one undo step.
      commitHistoryCoalesced(`nudge:${slide.id}`);
      const moves = new Map<string, { dx: number; dy: number }>();
      for (const id of dropDominatedIds(slide.nodes, selectedNodeIds)) moves.set(id, { dx, dy });
      moveNodes(slide.id, moves);
    },
    [slide, selectedNodeIds, commitHistoryCoalesced, moveNodes]
  );

  const arrange = useCallback(
    (direction: StackDirection) => {
      if (!slide || selectedNodeIds.length === 0) return;
      commitHistory();
      // To the front, the frontmost goes first so the selection keeps its
      // own order; the other way round for the back.
      const ids = dropDominatedIds(slide.nodes, selectedNodeIds);
      const ordered = direction === 'front' || direction === 'backward' ? ids : [...ids].reverse();
      for (const id of ordered) reorderNode(slide.id, id, direction);
    },
    [slide, selectedNodeIds, commitHistory, reorderNode]
  );

  const editText = useCallback(() => {
    if (!slide || selectedNodeIds.length !== 1) return;
    const node = findNodeById(slide.nodes, selectedNodeIds[0]);
    if (node?.type === 'text') startEditing(node.id);
  }, [slide, selectedNodeIds, startEditing]);

  const canPaste = useCallback(() => clipboardRef.current.length > 0, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || editingNodeId || !slide) return;
      // Keys pressed while a dialog / the presentation is open are theirs.
      if ((e.target as HTMLElement | null)?.closest?.('.modal-overlay, .presenter')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const has = selectedNodeIds.length > 0;
      let handled = true;

      if (mod && !e.altKey && key === 'c' && has) copy();
      else if (mod && !e.altKey && key === 'x' && has) cut();
      else if (mod && !e.altKey && key === 'v' && clipboardRef.current.length > 0) paste();
      else if (mod && key === 'd' && has) duplicate();
      else if (mod && key === 'a') selectAll();
      else if (mod && (e.key === ']' || e.code === 'BracketRight') && has) arrange(e.shiftKey ? 'front' : 'forward');
      else if (mod && (e.key === '[' || e.code === 'BracketLeft') && has) arrange(e.shiftKey ? 'back' : 'backward');
      else if (!mod && (e.key === 'Delete' || e.key === 'Backspace') && has) remove();
      else if (!mod && e.key.startsWith('Arrow') && has) {
        const step = e.shiftKey ? 10 : 1;
        nudge(
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        );
      } else if (!mod && e.key === 'Enter' && selectedNodeIds.length === 1) {
        const node = findNodeById(slide.nodes, selectedNodeIds[0]);
        if (node?.type === 'text') startEditing(node.id);
        else handled = false;
      } else if (!mod && e.key === 'Escape' && has) setSelectedNodes([]);
      else handled = false;

      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [slide, selectedNodeIds, editingNodeId, copy, cut, paste, duplicate, selectAll, arrange, remove, nudge, startEditing, setSelectedNodes]);

  return { canPaste, copy, cut, paste, duplicate, remove, selectAll, nudge, arrange, editText };
}
