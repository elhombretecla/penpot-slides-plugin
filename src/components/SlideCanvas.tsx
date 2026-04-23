import { useState, useRef, useCallback, useEffect } from 'react';
import { useSlideStore } from '../store';
import type { Slide, SlideNode } from '../types';
import {
  makeRectNode,
  makeEllipseNode,
  makeTextNode,
  fillsToCss,
  firstFillColor,
  findNodeById,
} from '../utils';

interface Props {
  slide: Slide | null;
}

type Tool = 'select' | 'text' | 'rect' | 'ellipse';

// The internal render size for the canvas editing area
const CANVAS_MAX_WIDTH = 640;
const CANVAS_MAX_HEIGHT = 400;

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.2;

function clampZoom(z: number) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

export default function SlideCanvas({ slide }: Props) {
  const [activeTool, setActiveTool] = useState<Tool>('select');
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
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
  const deleteNode = useSlideStore((s) => s.deleteNode);
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

  // Backspace / Delete removes every node in the current selection. Guarded
  // against input-like focus so typing into text fields (including the inline
  // text editor) still routes normally. Collapses into one history entry.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const editable = t?.isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) return;
      if (editingNodeId) return;
      if (!slide || selectedNodeIds.length === 0) return;
      e.preventDefault();
      commitHistory();
      const slideId = slide.id;
      for (const id of selectedNodeIds) deleteNode(slideId, id);
      setSelectedNodes([]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [slide, selectedNodeIds, editingNodeId, commitHistory, deleteNode, setSelectedNodes]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  if (!slide) {
    return (
      <div className="slide-canvas-empty">
        <p>Select a slide to edit</p>
      </div>
    );
  }

  const scaleX = CANVAS_MAX_WIDTH / slide.width;
  const scaleY = CANVAS_MAX_HEIGHT / slide.height;
  const fitScale = Math.min(scaleX, scaleY, 1);
  // Final scale combines fit-to-viewport with the user zoom; all internal
  // drag/resize math divides by this, so coordinate conversions stay correct
  // at any zoom level.
  const scale = fitScale * zoom;
  const displayW = slide.width * scale;
  const displayH = slide.height * scale;

  function toSlideCoords(canvasX: number, canvasY: number) {
    return { x: canvasX / scale, y: canvasY / scale };
  }

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!canvasRef.current) return;
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
    if (!canvasDragRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { startX, startY } = canvasDragRef.current;
    setCanvasDragRect({
      x: Math.min(x, startX),
      y: Math.min(y, startY),
      w: Math.abs(x - startX),
      h: Math.abs(y - startY),
    });
  }, []);

  const handleCanvasMouseUp = useCallback(
    (_e: React.MouseEvent<HTMLDivElement>) => {
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
      node = makeTextNode(x, y, Math.max(w, 120), Math.max(h, 40));
    }
    commitHistory();
    addNode(slideId, node);
    selectNode(node.id);
  }

  // Unified mousedown handler for every node on the canvas. Owns both the
  // selection update (shift-aware) and the drag gesture so multi-selection
  // can move as a group while each selected node keeps its own origin.
  const handleNodeMouseDown = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (activeTool !== 'select') return;
      e.stopPropagation();
      setEditingNodeId(null);

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
      // Snapshot positions for everyone in the active selection; we anchor
      // each to its own origin at mousedown and apply the cumulative delta
      // every frame.
      const snapshot = new Map<string, { x: number; y: number }>();
      for (const nid of nextSelection) {
        const n = findNodeById(slide.nodes, nid);
        if (n) snapshot.set(nid, { x: n.x, y: n.y });
      }
      if (snapshot.size === 0) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const slideId = slide.id;

      // Snapshot slides state BEFORE the drag actually mutates anything, so an
      // undo jumps back to the pre-drag arrangement. The many updateNode calls
      // during the gesture collapse into this single history entry.
      let committed = false;

      const onMove = (me: MouseEvent) => {
        const dx = (me.clientX - startX) / scale;
        const dy = (me.clientY - startY) / scale;
        if (!committed && (dx !== 0 || dy !== 0)) {
          commitHistory();
          committed = true;
        }
        snapshot.forEach((pos, nid) => {
          updateNode(slideId, nid, { x: pos.x + dx, y: pos.y + dy });
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [activeTool, commitHistory, selectedNodeIds, setSelectedNodes, slide, scale, updateNode]
  );

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
        <ToolButton tool="select" active={activeTool === 'select'} onClick={() => setActiveTool('select')}>
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
        <span className="canvas-slide-info">
          {slide.width} × {slide.height}
        </span>
        {slide.source === 'library-component' && (
          <span className="canvas-component-badge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="8" height="8" rx="1"/>
              <rect x="13" y="3" width="8" height="8" rx="1"/>
              <rect x="3" y="13" width="8" height="8" rx="1"/>
            </svg>
            Component
          </span>
        )}

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
        <div
          ref={canvasRef}
          className={`canvas-slide canvas-tool-${activeTool}`}
          style={{
            width: displayW,
            height: displayH,
            background: fillsToCss(slide.backgroundFills) ?? slide.background,
            position: 'relative',
            overflow: 'hidden',
          }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
        >
          <div className="canvas-bg" style={{ position: 'absolute', inset: 0 }} />

          {slide.nodesLoading ? (
            slide.thumbnailUrl ? (
              <img
                src={slide.thumbnailUrl}
                alt={slide.componentName ?? slide.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                draggable={false}
              />
            ) : (
              <div className="canvas-component-overlay">
                <div className="spinner" />
                <p className="canvas-component-hint">Loading slide content…</p>
              </div>
            )
          ) : (
            slide.nodes.map((node) => (
              <CanvasNode
                key={node.id}
                node={node}
                scale={scale}
                slideId={slide.id}
                activeTool={activeTool}
                selectedNodeIds={selectedNodeIds}
                editingNodeId={editingNodeId}
                onNodeMouseDown={handleNodeMouseDown}
                onStartEditing={(id) => {
                  // Each edit session (between double-click and blur) is one
                  // undoable step regardless of how many keystrokes happen.
                  commitHistory();
                  setEditingNodeId(id);
                  selectNode(id);
                }}
                onStopEditing={() => setEditingNodeId(null)}
                onTextChange={(id, text) => updateNode(slide.id, id, { text })}
                onResize={(id, patch) => updateNode(slide.id, id, patch)}
                onCommitHistory={commitHistory}
              />
            ))
          )}

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
      </div>
    </div>
  );
}

// ─── Canvas Node (recursive) ──────────────────────────────────────────────────

interface CanvasNodeProps {
  node: SlideNode;
  scale: number;
  slideId: string;
  activeTool: Tool;
  selectedNodeIds: string[];
  editingNodeId: string | null;
  onNodeMouseDown: (id: string, e: React.MouseEvent) => void;
  onStartEditing: (id: string) => void;
  onStopEditing: () => void;
  onTextChange: (id: string, text: string) => void;
  onResize: (id: string, patch: Partial<SlideNode>) => void;
  onCommitHistory: () => void;
}

function CanvasNode({
  node,
  scale,
  slideId,
  activeTool,
  selectedNodeIds,
  editingNodeId,
  onNodeMouseDown,
  onStartEditing,
  onStopEditing,
  onTextChange,
  onResize,
  onCommitHistory,
}: CanvasNodeProps) {
  const isSelected = selectedNodeIds.includes(node.id);
  const isEditing = editingNodeId === node.id;

  if (!node.visible) return null;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isEditing) return;
      onNodeMouseDown(node.id, e);
    },
    [isEditing, node.id, onNodeMouseDown]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (node.type !== 'text') return;
      e.stopPropagation();
      onStartEditing(node.id);
    },
    [node.id, node.type, onStartEditing]
  );

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

  if (isSelected && !isEditing) {
    wrapperStyle.outline = '2px solid #6457f0';
    wrapperStyle.outlineOffset = '1px';
  }

  // Groups render a container and recurse into children (children are
  // positioned relative to the group, so we just render them inside).
  // The clipping layer is a child div so the outer wrapper can host resize
  // handles outside the clipped area.
  if (node.type === 'group') {
    const groupBg = node.clipContent
      ? fillsToCss(node.fills) ?? node.fill ?? 'transparent'
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
            overflow: node.clipContent ? 'hidden' : 'visible',
          }}
        >
          {node.children?.map((child) => (
            <CanvasNode
              key={child.id}
              node={child}
              scale={scale}
              slideId={slideId}
              activeTool={activeTool}
              selectedNodeIds={selectedNodeIds}
              editingNodeId={editingNodeId}
              onNodeMouseDown={onNodeMouseDown}
              onStartEditing={onStartEditing}
              onStopEditing={onStopEditing}
              onTextChange={onTextChange}
              onResize={onResize}
              onCommitHistory={onCommitHistory}
            />
          ))}
        </div>
        {isSelected && !isEditing && activeTool === 'select' && (
          <ResizeHandles
            node={node}
            scale={scale}
            onResize={(patch) => onResize(node.id, patch)}
            onCommit={onCommitHistory}
          />
        )}
      </div>
    );
  }

  const content = (() => {
    if (node.type === 'text') {
      const textColor = firstFillColor(node.fills) ?? node.fontColor ?? '#ffffff';
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            color: textColor,
            fontSize: (node.fontSize ?? 16) * scale,
            fontWeight: node.fontWeight ?? '400',
            fontFamily: node.fontFamily ?? 'sans-serif',
            textAlign: node.textAlign ?? 'left',
            lineHeight: node.lineHeight ?? 1.4,
            letterSpacing: node.letterSpacing ? `${node.letterSpacing}px` : undefined,
            overflow: 'hidden',
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
          }}
        >
          {isEditing ? (
            <textarea
              autoFocus
              className="canvas-text-editor"
              style={{
                width: '100%',
                height: '100%',
                color: textColor,
                fontSize: (node.fontSize ?? 16) * scale,
                fontWeight: node.fontWeight ?? '400',
                fontFamily: node.fontFamily ?? 'sans-serif',
                textAlign: node.textAlign ?? 'left',
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
            background: fillsToCss(node.fills) ?? node.fill ?? '#6457f0',
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
            background: fillsToCss(node.fills) ?? node.fill ?? '#6457f0',
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
              objectFit: 'contain',
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
      {content}
      {isSelected && !isEditing && activeTool === 'select' && (
        <ResizeHandles
          node={node}
          scale={scale}
          onResize={(patch) => onResize(node.id, patch)}
          onCommit={onCommitHistory}
        />
      )}
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
  scale: number;
  onResize: (patch: Partial<SlideNode>) => void;
  onCommit: () => void;
}

function ResizeHandles({ node, scale, onResize, onCommit }: ResizeHandlesProps) {
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
        document.body.style.cursor = prevBodyCursor;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [node.x, node.y, node.width, node.height, onResize, onCommit, scale]
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
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
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
