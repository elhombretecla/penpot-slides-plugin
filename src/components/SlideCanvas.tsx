import { useState, useRef, useCallback, useEffect } from 'react';
import { useSlideStore } from '../store';
import type { Slide, SlideNode } from '../types';
import { makeRectNode, makeEllipseNode, makeTextNode, fillsToCss, firstFillColor } from '../utils';

interface Props {
  slide: Slide | null;
}

type Tool = 'select' | 'text' | 'rect' | 'ellipse';

// The internal render size for the canvas editing area
const CANVAS_MAX_WIDTH = 640;
const CANVAS_MAX_HEIGHT = 400;

export default function SlideCanvas({ slide }: Props) {
  const [activeTool, setActiveTool] = useState<Tool>('select');
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  const selectedNodeIds = useSlideStore((s) => s.selectedNodeIds);
  const selectNode = useSlideStore((s) => s.selectNode);
  const addNode = useSlideStore((s) => s.addNode);
  const updateNode = useSlideStore((s) => s.updateNode);

  const canvasRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef<{ startX: number; startY: number } | null>(null);
  const [drawingRect, setDrawingRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  if (!slide) {
    return (
      <div className="slide-canvas-empty">
        <p>Select a slide to edit</p>
      </div>
    );
  }

  const scaleX = CANVAS_MAX_WIDTH / slide.width;
  const scaleY = CANVAS_MAX_HEIGHT / slide.height;
  const scale = Math.min(scaleX, scaleY, 1);
  const displayW = slide.width * scale;
  const displayH = slide.height * scale;

  function toSlideCoords(canvasX: number, canvasY: number) {
    return { x: canvasX / scale, y: canvasY / scale };
  }

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (activeTool === 'select') {
        if (e.target === canvasRef.current || (e.target as HTMLElement).classList.contains('canvas-bg')) {
          selectNode(null);
          setEditingNodeId(null);
        }
        return;
      }

      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      drawingRef.current = { startX: x, startY: y };
      setDrawingRect({ x, y, w: 0, h: 0 });
    },
    [activeTool, selectNode]
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!drawingRef.current || activeTool === 'select') return;
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const { startX, startY } = drawingRef.current;
      setDrawingRect({
        x: Math.min(x, startX),
        y: Math.min(y, startY),
        w: Math.abs(x - startX),
        h: Math.abs(y - startY),
      });
    },
    [activeTool]
  );

  const handleCanvasMouseUp = useCallback(
    (_e: React.MouseEvent<HTMLDivElement>) => {
      if (!drawingRef.current || !drawingRect) return;
      drawingRef.current = null;

      const slideId = slide?.id;
      if (!slideId) return;

      const MIN_SIZE = 10;
      if (drawingRect.w < MIN_SIZE || drawingRect.h < MIN_SIZE) {
        setDrawingRect(null);
        const { x, y } = toSlideCoords(drawingRect.x, drawingRect.y);
        createNodeAtPos(slideId, x, y, 200, 100);
        setActiveTool('select');
        return;
      }

      const { x, y } = toSlideCoords(drawingRect.x, drawingRect.y);
      const { x: x2, y: y2 } = toSlideCoords(drawingRect.x + drawingRect.w, drawingRect.y + drawingRect.h);
      createNodeAtPos(slideId, x, y, x2 - x, y2 - y);
      setDrawingRect(null);
      setActiveTool('select');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTool, drawingRect, slide?.id]
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
    addNode(slideId, node);
    selectNode(node.id);
  }

  return (
    <div className="slide-canvas-container">
      {/* Toolbar */}
      <div className="canvas-toolbar">
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
      </div>

      {/* Canvas */}
      <div className="canvas-wrapper">
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
                onSelect={(id) => {
                  if (activeTool === 'select') {
                    selectNode(id);
                    setEditingNodeId(null);
                  }
                }}
                onStartEditing={(id) => {
                  setEditingNodeId(id);
                  selectNode(id);
                }}
                onStopEditing={() => setEditingNodeId(null)}
                onTextChange={(id, text) => updateNode(slide.id, id, { text })}
                onDrag={(id, dx, dy, n) => {
                  updateNode(slide.id, id, {
                    x: n.x + dx / scale,
                    y: n.y + dy / scale,
                  });
                }}
                onResize={(id, patch) => updateNode(slide.id, id, patch)}
              />
            ))
          )}

          {/* Drawing preview rect */}
          {drawingRect && drawingRect.w > 2 && drawingRect.h > 2 && (
            <div
              style={{
                position: 'absolute',
                left: drawingRect.x,
                top: drawingRect.y,
                width: drawingRect.w,
                height: drawingRect.h,
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
  onSelect: (id: string) => void;
  onStartEditing: (id: string) => void;
  onStopEditing: () => void;
  onTextChange: (id: string, text: string) => void;
  onDrag: (id: string, dx: number, dy: number, node: SlideNode) => void;
  onResize: (id: string, patch: Partial<SlideNode>) => void;
}

function CanvasNode({
  node,
  scale,
  slideId,
  activeTool,
  selectedNodeIds,
  editingNodeId,
  onSelect,
  onStartEditing,
  onStopEditing,
  onTextChange,
  onDrag,
  onResize,
}: CanvasNodeProps) {
  const dragStart = useRef<{ mouseX: number; mouseY: number } | null>(null);
  const isSelected = selectedNodeIds.includes(node.id);
  const isEditing = editingNodeId === node.id;

  if (!node.visible) return null;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool !== 'select') return;
      e.stopPropagation();
      onSelect(node.id);
      if (isEditing) return;
      dragStart.current = { mouseX: e.clientX, mouseY: e.clientY };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStart.current) return;
        // dx/dy are cumulative from the mousedown origin, not per-frame deltas.
        // The parent applies `node.x + dx` where `node` is the snapshot at
        // mousedown, so a per-frame delta would snap back to the origin each
        // frame instead of moving the element.
        const dx = moveEvent.clientX - dragStart.current.mouseX;
        const dy = moveEvent.clientY - dragStart.current.mouseY;
        onDrag(node.id, dx, dy, node);
      };

      const handleMouseUp = () => {
        dragStart.current = null;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [activeTool, isEditing, onDrag, onSelect, node]
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
              onSelect={onSelect}
              onStartEditing={onStartEditing}
              onStopEditing={onStopEditing}
              onTextChange={onTextChange}
              onDrag={onDrag}
              onResize={onResize}
            />
          ))}
        </div>
        {isSelected && !isEditing && activeTool === 'select' && (
          <ResizeHandles node={node} scale={scale} onResize={(patch) => onResize(node.id, patch)} />
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
        <ResizeHandles node={node} scale={scale} onResize={(patch) => onResize(node.id, patch)} />
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
}

function ResizeHandles({ node, scale, onResize }: ResizeHandlesProps) {
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

      const onMove = (me: MouseEvent) => {
        const dx = (me.clientX - startMouseX) / scale;
        const dy = (me.clientY - startMouseY) / scale;
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
    [node.x, node.y, node.width, node.height, onResize, scale]
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
