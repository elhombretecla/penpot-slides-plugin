import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useSlideStore } from '../store';
import { useElementSize } from '../hooks';
import type { Slide, SlideNode } from '../types';
import {
  makeRectNode,
  makeEllipseNode,
  makeTextNode,
  fillsToCss,
  findNodeById,
  findNodeAbs,
  textNodeCss,
  nodeBackground,
  slideBackgroundCss,
} from '../utils';
import { dropDominatedIds, freeCopies, useCanvasCommands } from '../canvas/commands';
import {
  placeNodes,
  snapBox,
  snapTargets,
  subtreeIds,
  unionBox,
  type Guide,
  type PlacedBox,
} from '../canvas/geometry';
import CanvasContextMenu from './CanvasContextMenu';
import { planRender, type RenderPlan } from '../render/plan';
import { useRenderStore } from '../render/renderer';
import SvgView from './SvgView';

interface Props {
  slide: Slide | null;
}

type Tool = 'select' | 'text' | 'rect' | 'ellipse';

// Breathing room around the slide inside the canvas area.
const CANVAS_PADDING = 24;

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.2;

// Screen pixels the pointer must travel before a press on a node becomes a
// move or a resize.
const DRAG_THRESHOLD_PX = 3;

// Snapping distance to guides, in screen pixels.
const SNAP_PX = 6;

// Current version of some nodes of a slide (drag deltas are applied to what
// the store holds now).
function findNodes(slides: Slide[], slideId: string, ids: string[]): Map<string, SlideNode> {
  const out = new Map<string, SlideNode>();
  const slide = slides.find((s) => s.id === slideId);
  if (!slide) return out;
  for (const id of ids) {
    const n = findNodeById(slide.nodes, id);
    if (n) out.set(id, n);
  }
  return out;
}

function clampZoom(z: number) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

export default function SlideCanvas({ slide }: Props) {
  const [activeTool, setActiveTool] = useState<Tool>('select');
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  // Node under the pointer: outlined like in Penpot, so it is clear what a
  // click will select (nested slots included).
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  // Smart guides shown while moving or resizing.
  const [guides, setGuides] = useState<Guide[]>([]);
  // Context menu, at a viewport position.
  const [menu, setMenu] = useState<{ x: number; y: number; slideX: number; slideY: number } | null>(null);
  // User-controlled zoom multiplier applied on top of the fit-to-viewport
  // scale. 1 = slide exactly fits the wrapper; larger values pan via
  // wrapper's overflow:auto.
  const [zoom, setZoom] = useState(1);
  const [zoomInputValue, setZoomInputValue] = useState('100');

  const selectedNodeIds = useSlideStore((s) => s.selectedNodeIds);
  const selectNode = useSlideStore((s) => s.selectNode);
  const setSelectedNodes = useSlideStore((s) => s.setSelectedNodes);
  const addNode = useSlideStore((s) => s.addNode);
  const updateNode = useSlideStore((s) => s.updateNode);
  const moveNodes = useSlideStore((s) => s.moveNodes);
  const commitHistory = useSlideStore((s) => s.commitHistory);
  const undo = useSlideStore((s) => s.undo);
  const redo = useSlideStore((s) => s.redo);
  const canUndo = useSlideStore((s) => s.history.past.length > 0);
  const canRedo = useSlideStore((s) => s.history.future.length > 0);

  // Keep the editable zoom input in sync whenever zoom changes from wheel /
  // shortcut / buttons (without clobbering the user's in-progress typing —
  // that's handled in the onChange/onBlur of the input itself).
  useEffect(() => {
    setZoomInputValue(String(Math.round(zoom * 100)));
  }, [zoom]);

  const zoomIn = useCallback(() => setZoom((z) => clampZoom(z * ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(z / ZOOM_STEP)), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  // Global keyboard shortcuts for undo/redo and zoom. Ignore when focus is
  // inside an input-like element so typing into the text editor or sidebar
  // fields still routes characters normally.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const editable = t?.isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === '+' || e.key === '=') {
        // '=' covers the common US layout where + requires shift. Either key
        // with Ctrl/Cmd means "zoom in".
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        zoomReset();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, zoomIn, zoomOut, zoomReset]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const wrapperSize = useElementSize(wrapperRef);

  // Ctrl/Cmd + wheel zoom. React's synthetic wheel listener is passive in
  // modern React, which blocks preventDefault — attach a native listener with
  // { passive: false } so the browser's built-in zoom doesn't fire instead.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      // deltaY > 0 when scrolling down/towards user → zoom out.
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setZoom((z) => clampZoom(z * factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Canvas-level drag covers two modes: 'draw' (creating a shape with the
  // rect/ellipse/text tools) and 'marquee' (rubber-band selection with the
  // select tool over empty canvas). `shiftKey` is captured at mousedown for
  // marquee additive selection.
  const canvasDragRef = useRef<
    | { startX: number; startY: number; mode: 'draw' | 'marquee'; shiftKey: boolean }
    | null
  >(null);
  const [canvasDragRect, setCanvasDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Last known mouse position in SLIDE coordinates while the pointer is over
  // the canvas. Used by paste to drop the clipboard under the cursor. Null
  // when the pointer is outside the slide.
  const mouseSlidePosRef = useRef<{ x: number; y: number } | null>(null);

  // Each edit session (between opening the text and leaving it) is one
  // undoable step regardless of how many keystrokes happen.
  const startEditing = useCallback(
    (id: string) => {
      commitHistory();
      setEditingNodeId(id);
      selectNode(id);
    },
    [commitHistory, selectNode]
  );
  const commands = useCanvasCommands(slide, editingNodeId, startEditing, mouseSlidePosRef);

  // Every hook below must run on every render (Rules of Hooks), so the
  // "no slide" early return lives right before the JSX, not here. Geometry
  // falls back to a 1×1 slide while there is nothing to show.
  const slideWidth = slide?.width || 1;
  const slideHeight = slide?.height || 1;
  // Fit the slide to the space the canvas area actually has.
  const availW = Math.max(120, wrapperSize.width - CANVAS_PADDING * 2);
  const availH = Math.max(80, wrapperSize.height - CANVAS_PADDING * 2);
  const fitScale = Math.min(availW / slideWidth, availH / slideHeight, 1);
  // Final scale combines fit-to-viewport with the user zoom; all internal
  // drag/resize math divides by this, so coordinate conversions stay correct
  // at any zoom level.
  const scale = fitScale * zoom;
  const displayW = slideWidth * scale;
  const displayH = slideHeight * scale;

  // Penpot render under the interactive HTML layer. The node being typed into
  // is always drawn live, as is anything changed since the last render.
  const renderEnabled = useRenderStore((s) => s.enabled);
  const slideRender = useRenderStore((s) => (slide ? s.renders[slide.id] : undefined));
  const liveTopId = useMemo(
    () => (slide && editingNodeId ? topLevelIdOf(slide.nodes, editingNodeId) : null),
    [slide, editingNodeId]
  );
  const plan: RenderPlan | null = useMemo(
    () => (slide && renderEnabled ? planRender(slide, slideRender, liveTopId) : null),
    [slide, renderEnabled, slideRender, liveTopId]
  );

  function toSlideCoords(canvasX: number, canvasY: number) {
    return { x: canvasX / scale, y: canvasY / scale };
  }

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!canvasRef.current || e.button !== 0) return;
      setMenu(null);
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (activeTool === 'select') {
        const onEmpty =
          e.target === canvasRef.current ||
          (e.target as HTMLElement).classList.contains('canvas-bg');
        if (!onEmpty) return;
        setEditingNodeId(null);
        // Shift preserves the current selection so the marquee can add to it;
        // without shift the selection resets now so intermediate marquee sizes
        // give immediate feedback.
        if (!e.shiftKey) selectNode(null);
        canvasDragRef.current = { startX: x, startY: y, mode: 'marquee', shiftKey: e.shiftKey };
        setCanvasDragRect({ x, y, w: 0, h: 0 });
        return;
      }

      canvasDragRef.current = { startX: x, startY: y, mode: 'draw', shiftKey: false };
      setCanvasDragRect({ x, y, w: 0, h: 0 });
    },
    [activeTool, selectNode]
  );

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Always track mouse in slide coordinates so paste can anchor to it,
    // regardless of whether a marquee/draw gesture is active.
    mouseSlidePosRef.current = { x: x / scale, y: y / scale };
    if (!canvasDragRef.current) return;
    const { startX, startY } = canvasDragRef.current;
    setCanvasDragRect({
      x: Math.min(x, startX),
      y: Math.min(y, startY),
      w: Math.abs(x - startX),
      h: Math.abs(y - startY),
    });
  }, [scale]);

  const handleCanvasMouseUp = useCallback(
    () => {
      const drag = canvasDragRef.current;
      if (!drag || !canvasDragRect) return;
      canvasDragRef.current = null;

      const slideId = slide?.id;
      if (!slideId) {
        setCanvasDragRect(null);
        return;
      }

      if (drag.mode === 'marquee') {
        // Convert the marquee from canvas pixels to slide coords, then hit-test
        // every top-level node. Children of groups are treated as part of their
        // parent — matches the "one level at a time" UX of Figma/Penpot.
        const sx1 = canvasDragRect.x / scale;
        const sy1 = canvasDragRect.y / scale;
        const sx2 = (canvasDragRect.x + canvasDragRect.w) / scale;
        const sy2 = (canvasDragRect.y + canvasDragRect.h) / scale;

        const hits: string[] = [];
        for (const n of slide?.nodes ?? []) {
          if (!n.visible) continue;
          const nx1 = n.x;
          const ny1 = n.y;
          const nx2 = n.x + n.width;
          const ny2 = n.y + n.height;
          const overlaps = !(nx2 < sx1 || nx1 > sx2 || ny2 < sy1 || ny1 > sy2);
          if (overlaps) hits.push(n.id);
        }

        if (drag.shiftKey) {
          const union = new Set([...selectedNodeIds, ...hits]);
          setSelectedNodes(Array.from(union));
        } else {
          setSelectedNodes(hits);
        }
        setCanvasDragRect(null);
        return;
      }

      // mode === 'draw': create a shape at the marquee bounds (or a default
      // 200×100 if the user just clicked without dragging).
      const MIN_SIZE = 10;
      if (canvasDragRect.w < MIN_SIZE || canvasDragRect.h < MIN_SIZE) {
        setCanvasDragRect(null);
        const { x, y } = toSlideCoords(canvasDragRect.x, canvasDragRect.y);
        createNodeAtPos(slideId, x, y, 200, 100);
        setActiveTool('select');
        return;
      }

      const { x, y } = toSlideCoords(canvasDragRect.x, canvasDragRect.y);
      const { x: x2, y: y2 } = toSlideCoords(
        canvasDragRect.x + canvasDragRect.w,
        canvasDragRect.y + canvasDragRect.h
      );
      createNodeAtPos(slideId, x, y, x2 - x, y2 - y);
      setCanvasDragRect(null);
      setActiveTool('select');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvasDragRect, slide?.id, slide?.nodes, scale, selectedNodeIds, setSelectedNodes]
  );

  function createNodeAtPos(slideId: string, x: number, y: number, w: number, h: number) {
    let node: SlideNode;
    if (activeTool === 'rect') {
      node = makeRectNode(`Rectangle ${Date.now() % 1000}`, x, y, w, h);
    } else if (activeTool === 'ellipse') {
      node = { ...makeEllipseNode(`Ellipse ${Date.now() % 1000}`, x, y, Math.min(w, h)), width: w, height: h };
    } else {
      node = makeTextNode(x, y, Math.max(w, 120), Math.max(h, 40), slideWidth);
    }
    commitHistory();
    addNode(slideId, node);
    selectNode(node.id);
    // A new text box is for typing: open it straight away.
    if (node.type === 'text') setEditingNodeId(node.id);
  }

  // Unified mousedown handler for every node on the canvas. Owns both the
  // selection update (shift-aware) and the drag gesture so multi-selection
  // can move as a group while each selected node keeps its own origin.
  const handleNodeMouseDown = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (activeTool !== 'select') return;
      e.stopPropagation();
      setEditingNodeId(null);
      setMenu(null);

      // Right press: select for the context menu, never drag.
      if (e.button !== 0) {
        if (!selectedNodeIds.includes(id)) setSelectedNodes([id]);
        return;
      }

      const alreadySelected = selectedNodeIds.includes(id);

      // Decide the active selection for THIS gesture synchronously so the
      // drag snapshot below captures the right set — React state updates are
      // async, but we already know the intent from the click.
      let nextSelection: string[];
      if (e.shiftKey) {
        nextSelection = alreadySelected
          ? selectedNodeIds.filter((x) => x !== id)
          : [...selectedNodeIds, id];
      } else if (!alreadySelected) {
        nextSelection = [id];
      } else {
        nextSelection = selectedNodeIds;
      }

      if (nextSelection !== selectedNodeIds) {
        setSelectedNodes(nextSelection);
      }

      // After a shift-unselect or when the gesture ends up empty, there is
      // nothing to drag.
      if (!nextSelection.includes(id)) return;

      if (!slide) return;
      const slideId = slide.id;
      const startX = e.clientX;
      const startY = e.clientY;
      const duplicateOnDrag = e.altKey;

      // Everyone in the selection moves from its own origin by the same
      // delta; a child selected with its parent moves only with the parent.
      let ids = dropDominatedIds(slide.nodes, nextSelection);
      const placed = placeNodes(slide.nodes);
      const byId = new Map(placed.map((p) => [p.id, p]));
      let origins = new Map<string, { x: number; y: number }>();
      for (const nid of ids) {
        const p = byId.get(nid);
        if (p) origins.set(nid, { x: p.node.x, y: p.node.y });
      }
      if (origins.size === 0) return;
      const startBox = unionBox(ids.map((nid) => byId.get(nid)).filter((p): p is PlacedBox => !!p));
      const targets = snapTargets(placed, subtreeIds(slide.nodes, ids), slide.width, slide.height);

      // History is committed on the first real movement only, so the whole
      // gesture is one undo step and a plain click is none.
      let started = false;

      const onMove = (me: MouseEvent) => {
        // A click is never a move: hand jitter would otherwise nudge the node
        // by a pixel, mark it edited and swap its Penpot render for HTML.
        if (!started) {
          if (Math.hypot(me.clientX - startX, me.clientY - startY) < DRAG_THRESHOLD_PX) return;
          commitHistory();
          started = true;
          // Alt-drag leaves the originals in place and moves copies.
          if (duplicateOnDrag || me.altKey) {
            const copies = freeCopies(slide, ids);
            origins = new Map();
            for (const c of copies) {
              c.node.x = c.absX;
              c.node.y = c.absY;
              addNode(slideId, c.node);
              origins.set(c.node.id, { x: c.absX, y: c.absY });
            }
            ids = copies.map((c) => c.node.id);
            setSelectedNodes(ids);
          }
        }
        let dx = (me.clientX - startX) / scale;
        let dy = (me.clientY - startY) / scale;
        // Shift keeps the move on one axis.
        const lock = me.shiftKey ? (Math.abs(dx) >= Math.abs(dy) ? 'y' : 'x') : null;
        if (lock === 'y') dy = 0;
        if (lock === 'x') dx = 0;
        let shown: Guide[] = [];
        // Ctrl / Cmd moves freely, without snapping.
        if (startBox && !(me.ctrlKey || me.metaKey)) {
          const snap = snapBox({ ...startBox, x: startBox.x + dx, y: startBox.y + dy }, targets, SNAP_PX / scale);
          if (lock !== 'x') dx += snap.dx;
          if (lock !== 'y') dy += snap.dy;
          shown = snap.guides.filter((g) => g.axis !== lock);
        }
        setGuides(shown);
        const moves = new Map<string, { dx: number; dy: number }>();
        const current = findNodes(useSlideStore.getState().slides, slideId, ids);
        origins.forEach((o, nid) => {
          const n = current.get(nid);
          if (n) moves.set(nid, { dx: o.x + dx - n.x, dy: o.y + dy - n.y });
        });
        moveNodes(slideId, moves);
      };
      const onUp = () => {
        // A plain click on one element of a multiple selection keeps just
        // that one (the selection stays only for a drag).
        if (!started && !e.shiftKey && nextSelection.length > 1) setSelectedNodes([id]);
        setGuides([]);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [activeTool, addNode, commitHistory, moveNodes, selectedNodeIds, setSelectedNodes, slide, scale]
  );

  useKeyboardTools(setActiveTool);


  if (!slide) {
    return (
      <div className="slide-canvas-empty">
        <p>Select a slide to edit</p>
      </div>
    );
  }

  return (
    <div className="slide-canvas-container">
      {/* Toolbar */}
      <div className="canvas-toolbar">
        <button
          className="canvas-tool-btn"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
          </svg>
        </button>
        <button
          className="canvas-tool-btn"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 15-6.7L21 13" />
          </svg>
        </button>
        <div className="toolbar-divider" />
        <ToolButton tool="select" active={activeTool === 'select'} onClick={() => setActiveTool('select')} title="Select (V)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 3l14 9-7 1-4 7L5 3z"/>
          </svg>
        </ToolButton>
        <div className="toolbar-divider" />
        <ToolButton tool="text" active={activeTool === 'text'} onClick={() => setActiveTool('text')} title="Text (T)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 7 4 4 20 4 20 7"/>
            <line x1="9" y1="20" x2="15" y2="20"/>
            <line x1="12" y1="4" x2="12" y2="20"/>
          </svg>
        </ToolButton>
        <ToolButton tool="rect" active={activeTool === 'rect'} onClick={() => setActiveTool('rect')} title="Rectangle (R)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
          </svg>
        </ToolButton>
        <ToolButton tool="ellipse" active={activeTool === 'ellipse'} onClick={() => setActiveTool('ellipse')} title="Ellipse (E)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <ellipse cx="12" cy="12" rx="10" ry="7"/>
          </svg>
        </ToolButton>
        <div className="toolbar-divider" />

        <div className="canvas-zoom-group">
          <button
            className="canvas-tool-btn"
            onClick={zoomOut}
            disabled={zoom <= ZOOM_MIN + 1e-6}
            title="Zoom out (Ctrl+-)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <input
            className="canvas-zoom-input"
            type="text"
            value={`${zoomInputValue}%`}
            onChange={(e) => {
              // Keep only digits while editing so the displayed "%" doesn't
              // force the user to delete it every time.
              setZoomInputValue(e.target.value.replace(/[^0-9]/g, ''));
            }}
            onBlur={() => {
              const n = parseInt(zoomInputValue, 10);
              if (!Number.isFinite(n) || n <= 0) {
                setZoomInputValue(String(Math.round(zoom * 100)));
                return;
              }
              setZoom(clampZoom(n / 100));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setZoomInputValue(String(Math.round(zoom * 100)));
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            onDoubleClick={zoomReset}
            title="Zoom (double-click to reset)"
          />
          <button
            className="canvas-tool-btn"
            onClick={zoomIn}
            disabled={zoom >= ZOOM_MAX - 1e-6}
            title="Zoom in (Ctrl++)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="canvas-wrapper" ref={wrapperRef}>
        <div className="canvas-stage" style={{ width: displayW, height: displayH }}>
        <div
          ref={canvasRef}
          className={`canvas-slide canvas-tool-${activeTool}`}
          style={{
            width: displayW,
            height: displayH,
            background: slideBackgroundCss(slide),
            position: 'relative',
            overflow: 'hidden',
          }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseOver={(e) => {
            const el = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
            const id = el?.dataset.nodeId ?? null;
            if (id !== hoverNodeId) setHoverNodeId(id);
          }}
          onMouseLeave={() => {
            mouseSlidePosRef.current = null;
            setHoverNodeId(null);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (activeTool !== 'select' || !canvasRef.current) return;
            const onNode = (e.target as HTMLElement).closest('[data-node-id]');
            if (!onNode) setSelectedNodes([]);
            setEditingNodeId(null);
            const rect = canvasRef.current.getBoundingClientRect();
            setMenu({
              x: e.clientX,
              y: e.clientY,
              slideX: (e.clientX - rect.left) / scale,
              slideY: (e.clientY - rect.top) / scale,
            });
          }}
        >
          <div className="canvas-bg" style={{ position: 'absolute', inset: 0 }} />
          {plan && <SvgView svg={plan.render.svg} hiddenNodes={plan.hidden} className="canvas-render" />}

          {slide.nodes.map((node) => (
              <CanvasNode
                key={node.id}
                node={node}
                ghost={!!plan && !plan.html.has(node.id)}
                scale={scale}
                slideId={slide.id}
                activeTool={activeTool}
                editingNodeId={editingNodeId}
                onNodeMouseDown={handleNodeMouseDown}
                onStartEditing={startEditing}
                onStopEditing={() => setEditingNodeId(null)}
                onTextChange={(id, text) => updateNode(slide.id, id, { text })}
              />
            ))}

          {/* Drawing / marquee preview rect */}
          {canvasDragRect && canvasDragRect.w > 2 && canvasDragRect.h > 2 && (
            <div
              style={{
                position: 'absolute',
                left: canvasDragRect.x,
                top: canvasDragRect.y,
                width: canvasDragRect.w,
                height: canvasDragRect.h,
                border: '1.5px dashed #6457f0',
                background: 'rgba(100, 87, 240, 0.08)',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
        <SelectionOverlay
          nodes={slide.nodes}
          selectedIds={selectedNodeIds}
          hoverId={activeTool === 'select' && !canvasDragRect ? hoverNodeId : null}
          editingId={editingNodeId}
          scale={scale}
          slideWidth={slide.width}
          slideHeight={slide.height}
          guides={guides}
          onGuides={setGuides}
          handles={activeTool === 'select'}
          onResize={(id, patch) => updateNode(slide.id, id, patch)}
          onCommit={commitHistory}
        />
        {menu && (
          <CanvasContextMenu
            x={menu.x}
            y={menu.y}
            slide={slide}
            selectedIds={selectedNodeIds}
            commands={commands}
            onPasteHere={() => commands.paste({ x: menu.slideX, y: menu.slideY })}
            onClose={() => setMenu(null)}
          />
        )}
        </div>
      </div>
    </div>
  );
}

// ─── Static preview ───────────────────────────────────────────────────────────

const noop = () => {};

// Read-only rendering of a slide at a given width, with the exact renderer of
// the editor (clipping, image fills, text styles) — used for slide thumbnails.
export function SlidePreview({ slide, width }: { slide: Slide; width: number }) {
  const scale = width / Math.max(1, slide.width);
  const enabled = useRenderStore((s) => s.enabled);
  const render = useRenderStore((s) => s.renders[slide.id]);
  const plan = useMemo(() => (enabled ? planRender(slide, render) : null), [enabled, slide, render]);
  const nodes = plan ? slide.nodes.filter((n) => plan.html.has(n.id)) : slide.nodes;
  return (
    <div
      className="slide-preview"
      style={{
        width,
        height: slide.height * scale,
        position: 'relative',
        overflow: 'hidden',
        background: slideBackgroundCss(slide),
        pointerEvents: 'none',
      }}
    >
      {plan && <SvgView svg={plan.render.svg} hiddenNodes={plan.hidden} className="canvas-render" />}
      {nodes.map((node) => (
        <CanvasNode
          key={node.id}
          node={node}
          scale={scale}
          slideId={slide.id}
          activeTool="select"
          editingNodeId={null}
          onNodeMouseDown={noop}
          onStartEditing={noop}
          onStopEditing={noop}
          onTextChange={noop}
        />
      ))}
    </div>
  );
}

// Top-level node whose subtree contains `id`.
function topLevelIdOf(nodes: SlideNode[], id: string): string | null {
  const contains = (n: SlideNode): boolean => n.id === id || (n.children ?? []).some(contains);
  return nodes.find(contains)?.id ?? null;
}

// Entering a text edit selects the whole text, as in Penpot and Slides; the
// ref callback runs once per mounted editor, so later clicks keep their caret.
function focusAndSelectAll(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.focus();
  el.select();
}

// ─── Canvas Node (recursive) ──────────────────────────────────────────────────

interface CanvasNodeProps {
  node: SlideNode;
  // Drawn by the Penpot render underneath: keep the node interactive
  // (selection, drag, handles) but don't paint it.
  ghost?: boolean;
  scale: number;
  slideId: string;
  activeTool: Tool;
  editingNodeId: string | null;
  onNodeMouseDown: (id: string, e: React.MouseEvent) => void;
  onStartEditing: (id: string) => void;
  onStopEditing: () => void;
  onTextChange: (id: string, text: string) => void;
}

function CanvasNode({
  node,
  ghost = false,
  scale,
  slideId,
  activeTool,
  editingNodeId,
  onNodeMouseDown,
  onStartEditing,
  onStopEditing,
  onTextChange,
}: CanvasNodeProps) {
  const isEditing = editingNodeId === node.id;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // While typing, the press belongs to the text field (caret, selection
      // drag): it must not reach a parent group, which would select and drag
      // it and end the edit.
      if (isEditing) {
        e.stopPropagation();
        return;
      }
      onNodeMouseDown(node.id, e);
    },
    [isEditing, node.id, onNodeMouseDown]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (node.type !== 'text') return;
      e.stopPropagation();
      // Inside the editor a double-click is the native word selection.
      if (isEditing) return;
      onStartEditing(node.id);
    },
    [isEditing, node.id, node.type, onStartEditing]
  );

  // After the hooks: hiding a layer must not change the hook call order.
  if (!node.visible) return null;

  const wrapperStyle: React.CSSProperties = {
    position: 'absolute',
    left: node.x * scale,
    top: node.y * scale,
    width: node.width * scale,
    height: node.height * scale,
    opacity: node.opacity,
    transform: `rotate(${node.rotation}deg)`,
    cursor: activeTool === 'select' ? (isEditing ? 'text' : 'move') : 'crosshair',
    userSelect: 'none',
    boxSizing: 'border-box',
  };

  // Groups render a container and recurse into children (children are
  // positioned relative to the group, so we just render them inside).
  // The clipping layer is a child div so the outer wrapper can host resize
  // handles outside the clipped area.
  if (node.type === 'group') {
    const groupBg = node.clipContent || node.fills?.length
      ? nodeBackground(node.fills, node.fill ?? 'transparent', node.imageUrl) ?? 'transparent'
      : 'transparent';
    return (
      <div
        style={wrapperStyle}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        data-node-id={node.id}
        data-node-type="group"
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: groupBg,
            borderRadius: node.borderRadius ? node.borderRadius * scale : undefined,
            overflow: node.clipContent ? 'hidden' : 'visible',
            opacity: ghost ? 0 : undefined,
          }}
        >
          {node.children?.map((child) => (
            <CanvasNode
              key={child.id}
              node={child}
              scale={scale}
              slideId={slideId}
              activeTool={activeTool}
              editingNodeId={editingNodeId}
              onNodeMouseDown={onNodeMouseDown}
              onStartEditing={onStartEditing}
              onStopEditing={onStopEditing}
              onTextChange={onTextChange}
            />
          ))}
        </div>
      </div>
    );
  }

  const content = (() => {
    if (node.type === 'text') {
      const css = textNodeCss(node, scale);
      return (
        <div style={css}>
          {isEditing ? (
            <textarea
              ref={focusAndSelectAll}
              className="canvas-text-editor"
              style={{
                width: '100%',
                height: '100%',
                color: css.color,
                font: 'inherit',
                fontSize: css.fontSize,
                textAlign: css.textAlign,
                textTransform: css.textTransform,
                letterSpacing: css.letterSpacing,
                lineHeight: css.lineHeight,
                background: 'transparent',
                border: '1px solid #6457f0',
                resize: 'none',
                outline: 'none',
                padding: 0,
              }}
              value={node.text ?? ''}
              onChange={(e) => onTextChange(node.id, e.target.value)}
              onBlur={onStopEditing}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onStopEditing();
              }}
              onMouseDown={(e) => {
                // A press inside the selected text would start a native text
                // drag instead of a new selection; collapse it first so the
                // press places the caret and dragging selects, as in Penpot.
                if (e.detail !== 1 || e.shiftKey) return;
                const el = e.currentTarget;
                el.setSelectionRange(el.selectionStart, el.selectionStart);
              }}
              onDragStart={(e) => e.preventDefault()}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          ) : (
            node.text
          )}
        </div>
      );
    }

    if (node.type === 'rect') {
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: nodeBackground(node.fills, node.fill, node.imageUrl) ?? '#6457f0',
            borderRadius: node.borderRadius ? node.borderRadius * scale : 0,
            border: node.strokeColor ? `${(node.strokeWidth ?? 1) * scale}px solid ${node.strokeColor}` : undefined,
          }}
        />
      );
    }

    if (node.type === 'ellipse') {
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: nodeBackground(node.fills, node.fill, node.imageUrl) ?? '#6457f0',
            borderRadius: '50%',
            border: node.strokeColor ? `${(node.strokeWidth ?? 1) * scale}px solid ${node.strokeColor}` : undefined,
          }}
        />
      );
    }

    if (node.type === 'image' || node.type === 'path') {
      if (node.imageUrl) {
        return (
          <img
            src={node.imageUrl}
            alt={node.name}
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              // A replaced picture fills its slot like an image fill does;
              // rendered snapshots of vectors must not be cropped.
              objectFit: node.imageReplaced ? 'cover' : 'contain',
              borderRadius: node.borderRadius ? node.borderRadius * scale : undefined,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        );
      }
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: fillsToCss(node.fills) ?? node.fill ?? 'rgba(100,87,240,0.15)',
            border: '1px dashed rgba(100,87,240,0.5)',
          }}
        />
      );
    }

    if (node.type === 'component-instance') {
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            background: 'rgba(100,87,240,0.08)',
            border: '1px dashed rgba(100,87,240,0.4)',
          }}
        >
          {node.imageUrl ? (
            <img
              src={node.imageUrl}
              alt={node.componentName ?? node.name}
              draggable={false}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            />
          ) : null}
          <span
            style={{
              position: 'absolute',
              top: 4,
              left: 4,
              padding: '1px 4px',
              fontSize: 9 * Math.max(scale, 0.5),
              borderRadius: 2,
              background: 'rgba(100,87,240,0.9)',
              color: '#fff',
              pointerEvents: 'none',
            }}
          >
            Instance
          </span>
        </div>
      );
    }

    return null;
  })();

  return (
    <div
      style={wrapperStyle}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      data-node-id={node.id}
      data-node-type={node.type}
    >
      {ghost ? <div className="canvas-node-ghost">{content}</div> : content}
    </div>
  );
}

// ─── Selection overlay ────────────────────────────────────────────────────────

// Selection and hover boxes live in their own layer above the slide, in
// absolute slide coordinates: a group's clipping, the hidden HTML twin of a
// Penpot-rendered node or the slide edge can no longer hide them.
interface SelectionOverlayProps {
  nodes: SlideNode[];
  selectedIds: string[];
  hoverId: string | null;
  editingId: string | null;
  scale: number;
  slideWidth: number;
  slideHeight: number;
  guides: Guide[];
  onGuides: (guides: Guide[]) => void;
  handles: boolean;
  onResize: (id: string, patch: Partial<SlideNode>) => void;
  onCommit: () => void;
}

function SelectionOverlay({
  nodes, selectedIds, hoverId, editingId, scale, slideWidth, slideHeight, guides, onGuides, handles, onResize, onCommit,
}: SelectionOverlayProps) {
  const boxStyle = (absX: number, absY: number, node: SlideNode): React.CSSProperties => ({
    position: 'absolute',
    left: absX * scale,
    top: absY * scale,
    width: node.width * scale,
    height: node.height * scale,
    transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
  });
  const boxes = selectedIds
    .filter((id) => id !== editingId)
    .map((id) => findNodeAbs(nodes, id))
    .filter((f): f is NonNullable<typeof f> => !!f && f.node.visible);
  const hover = hoverId && hoverId !== editingId && !selectedIds.includes(hoverId)
    ? findNodeAbs(nodes, hoverId)
    : null;

  return (
    <div className="canvas-overlay">
      {hover && hover.node.visible && (
        <div className="canvas-hover-box" style={boxStyle(hover.absX, hover.absY, hover.node)} />
      )}
      {boxes.map(({ node, absX, absY }) => (
        <div key={node.id} className="canvas-selection-box" style={boxStyle(absX, absY, node)}>
          {handles && selectedIds.length === 1 && (
            <ResizeHandles
              node={node}
              nodes={nodes}
              slideWidth={slideWidth}
              slideHeight={slideHeight}
              scale={scale}
              onGuides={onGuides}
              onResize={(patch) => onResize(node.id, patch)}
              onCommit={onCommit}
            />
          )}
        </div>
      ))}
      {guides.map((g, i) => (
        <div
          key={i}
          className="canvas-guide"
          style={
            g.axis === 'x'
              ? { left: g.at * scale, top: g.from * scale, width: 1, height: Math.max(1, (g.to - g.from) * scale) }
              : { top: g.at * scale, left: g.from * scale, height: 1, width: Math.max(1, (g.to - g.from) * scale) }
          }
        />
      ))}
    </div>
  );
}

// ─── Resize Handles ───────────────────────────────────────────────────────────

type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

// Map each handle direction to its CSS cursor so the pointer matches the axis
// the user will drag along.
const CURSOR: Record<HandleDir, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

// Minimum node size in slide units so a user cannot shrink a node to zero and
// lose it.
const MIN_SIZE = 8;

interface ResizeHandlesProps {
  node: SlideNode;
  nodes: SlideNode[];
  slideWidth: number;
  slideHeight: number;
  scale: number;
  onGuides: (guides: Guide[]) => void;
  onResize: (patch: Partial<SlideNode>) => void;
  onCommit: () => void;
}

function ResizeHandles({ node, nodes, slideWidth, slideHeight, scale, onGuides, onResize, onCommit }: ResizeHandlesProps) {
  const startResize = useCallback(
    (dir: HandleDir, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const origX = node.x;
      const origY = node.y;
      const origW = node.width;
      const origH = node.height;
      const ratio = origW / Math.max(origH, 0.0001);
      const corner = dir.length === 2;

      // Moving edges snap to the slide and the other elements.
      const placed = placeNodes(nodes);
      const self = placed.find((p) => p.id === node.id);
      const parentX = self?.parentX ?? 0;
      const parentY = self?.parentY ?? 0;
      const targets = snapTargets(placed, subtreeIds(nodes, [node.id]), slideWidth, slideHeight);
      const edges = {
        x: dir.includes('w') ? ['start' as const] : dir.includes('e') ? ['end' as const] : [],
        y: dir.includes('n') ? ['start' as const] : dir.includes('s') ? ['end' as const] : [],
      };

      // Keep the cursor consistent for the whole gesture, even when the mouse
      // leaves the handle itself.
      const prevBodyCursor = document.body.style.cursor;
      document.body.style.cursor = CURSOR[dir];

      // Commit history once, on the first real movement — a mousedown-mouseup
      // without drag shouldn't produce an undo entry.
      let committed = false;

      const onMove = (me: MouseEvent) => {
        const dx = (me.clientX - startMouseX) / scale;
        const dy = (me.clientY - startMouseY) / scale;
        if (!committed && (dx !== 0 || dy !== 0)) {
          onCommit();
          committed = true;
        }
        let x = origX;
        let y = origY;
        let w = origW;
        let h = origH;

        if (dir.includes('w')) {
          x = origX + dx;
          w = origW - dx;
        }
        if (dir.includes('e')) {
          w = origW + dx;
        }
        if (dir.includes('n')) {
          y = origY + dy;
          h = origH - dy;
        }
        if (dir.includes('s')) {
          h = origH + dy;
        }

        let shown: Guide[] = [];
        if (me.shiftKey && corner) {
          // Shift keeps the proportions, following the dominant axis.
          if (Math.abs(w - origW) / origW >= Math.abs(h - origH) / Math.max(origH, 0.0001)) {
            h = w / ratio;
          } else {
            w = h * ratio;
          }
          if (dir.includes('w')) x = origX + origW - w;
          if (dir.includes('n')) y = origY + origH - h;
        } else if (!(me.ctrlKey || me.metaKey)) {
          const snap = snapBox({ x: parentX + x, y: parentY + y, width: w, height: h }, targets, SNAP_PX / scale, edges);
          if (dir.includes('w')) { x += snap.dx; w -= snap.dx; }
          if (dir.includes('e')) w += snap.dx;
          if (dir.includes('n')) { y += snap.dy; h -= snap.dy; }
          if (dir.includes('s')) h += snap.dy;
          shown = snap.guides;
        }
        onGuides(shown);

        // Clamp against MIN_SIZE while keeping the opposite edge anchored.
        if (w < MIN_SIZE) {
          if (dir.includes('w')) x = origX + origW - MIN_SIZE;
          w = MIN_SIZE;
        }
        if (h < MIN_SIZE) {
          if (dir.includes('n')) y = origY + origH - MIN_SIZE;
          h = MIN_SIZE;
        }

        onResize({ x, y, width: w, height: h });
      };

      const onUp = () => {
        onGuides([]);
        document.body.style.cursor = prevBodyCursor;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [node.id, node.x, node.y, node.width, node.height, nodes, slideWidth, slideHeight, onGuides, onResize, onCommit, scale]
  );

  const size = 8;
  const off = -size / 2;
  const baseHandle: React.CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    background: '#ffffff',
    border: '1.5px solid #6457f0',
    borderRadius: 1,
    boxSizing: 'border-box',
    zIndex: 2,
    pointerEvents: 'auto',
  };

  const handles: Array<{ dir: HandleDir; style: React.CSSProperties }> = [
    { dir: 'nw', style: { top: off, left: off } },
    { dir: 'n', style: { top: off, left: '50%', marginLeft: off } },
    { dir: 'ne', style: { top: off, right: off } },
    { dir: 'e', style: { top: '50%', right: off, marginTop: off } },
    { dir: 'se', style: { bottom: off, right: off } },
    { dir: 's', style: { bottom: off, left: '50%', marginLeft: off } },
    { dir: 'sw', style: { bottom: off, left: off } },
    { dir: 'w', style: { top: '50%', left: off, marginTop: off } },
  ];

  return (
    <>
      {handles.map((h) => (
        <div
          key={h.dir}
          style={{ ...baseHandle, ...h.style, cursor: CURSOR[h.dir] }}
          onMouseDown={(e) => startResize(h.dir, e)}
        />
      ))}
    </>
  );
}

// ─── Tool Button ──────────────────────────────────────────────────────────────

interface ToolButtonProps {
  tool: Tool;
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}

function ToolButton({ active, onClick, title, children }: ToolButtonProps) {
  return (
    <button
      className={`canvas-tool-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

function useKeyboardTools(setActiveTool: (t: Tool) => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Modifier chords belong to copy/paste/undo/zoom, not to tool switching.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if (e.key === 'v' || e.key === 'V') setActiveTool('select');
      if (e.key === 't' || e.key === 'T') setActiveTool('text');
      if (e.key === 'r' || e.key === 'R') setActiveTool('rect');
      if (e.key === 'e' || e.key === 'E') setActiveTool('ellipse');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setActiveTool]);
}

export { useKeyboardTools };
