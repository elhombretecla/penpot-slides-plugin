import { useState, useRef, useCallback, useEffect } from 'react';
import { useSlideStore } from '../store';
import type { Slide, SlideNode } from '../types';
import { makeRectNode, makeEllipseNode, makeTextNode } from '../utils';

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

  // Scale factor: fit slide into canvas display area
  const scaleX = CANVAS_MAX_WIDTH / slide.width;
  const scaleY = CANVAS_MAX_HEIGHT / slide.height;
  const scale = Math.min(scaleX, scaleY, 1);
  const displayW = slide.width * scale;
  const displayH = slide.height * scale;

  // Convert canvas-relative coords to slide-space coords
  function toSlideCoords(canvasX: number, canvasY: number) {
    return { x: canvasX / scale, y: canvasY / scale };
  }

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (activeTool === 'select') {
        // Click on canvas background → deselect
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
        // Single click: create at default size at that position
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
            background: slide.background,
            position: 'relative',
            overflow: 'hidden',
          }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
        >
          <div className="canvas-bg" style={{ position: 'absolute', inset: 0 }} />

          {slide.source === 'library-component' ? (
            <div className="canvas-component-overlay">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.4">
                <rect x="3" y="3" width="8" height="8" rx="1"/>
                <rect x="13" y="3" width="8" height="8" rx="1"/>
                <rect x="3" y="13" width="8" height="8" rx="1"/>
                <rect x="13" y="13" width="8" height="8" rx="1"/>
              </svg>
              <p>{slide.componentName}</p>
              <p className="canvas-component-hint">Component from library. Will be instantiated when exported.</p>
            </div>
          ) : (
            slide.nodes.filter((n) => n.visible).map((node) => (
              <CanvasNode
                key={node.id}
                node={node}
                scale={scale}
                slideId={slide.id}
                isSelected={selectedNodeIds.includes(node.id)}
                isEditing={editingNodeId === node.id}
                onSelect={(e) => {
                  e.stopPropagation();
                  if (activeTool === 'select') {
                    selectNode(node.id);
                    setEditingNodeId(null);
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (node.type === 'text') {
                    setEditingNodeId(node.id);
                    selectNode(node.id);
                  }
                }}
                onTextChange={(text) => updateNode(slide.id, node.id, { text })}
                onStopEditing={() => setEditingNodeId(null)}
                onDrag={(dx, dy) => {
                  updateNode(slide.id, node.id, {
                    x: node.x + dx / scale,
                    y: node.y + dy / scale,
                  });
                }}
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

// ─── Canvas Node ──────────────────────────────────────────────────────────────

interface CanvasNodeProps {
  node: SlideNode;
  scale: number;
  slideId: string;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  onTextChange: (text: string) => void;
  onStopEditing: () => void;
  onDrag: (dx: number, dy: number) => void;
}

function CanvasNode({
  node,
  scale,
  isSelected,
  isEditing,
  onSelect,
  onDoubleClick,
  onTextChange,
  onStopEditing,
  onDrag,
}: CanvasNodeProps) {
  const dragStart = useRef<{ mouseX: number; mouseY: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      onSelect(e);
      if (isEditing) return;
      dragStart.current = { mouseX: e.clientX, mouseY: e.clientY };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStart.current) return;
        const dx = moveEvent.clientX - dragStart.current.mouseX;
        const dy = moveEvent.clientY - dragStart.current.mouseY;
        dragStart.current = { mouseX: moveEvent.clientX, mouseY: moveEvent.clientY };
        onDrag(dx, dy);
      };

      const handleMouseUp = () => {
        dragStart.current = null;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [isEditing, onDrag, onSelect]
  );

  const nodeStyle: React.CSSProperties = {
    position: 'absolute',
    left: node.x * scale,
    top: node.y * scale,
    width: node.width * scale,
    height: node.height * scale,
    opacity: node.opacity,
    transform: `rotate(${node.rotation}deg)`,
    cursor: isEditing ? 'text' : 'move',
    userSelect: 'none',
    boxSizing: 'border-box',
  };

  if (isSelected && !isEditing) {
    nodeStyle.outline = '2px solid #6457f0';
    nodeStyle.outlineOffset = '1px';
  }

  const content = (() => {
    if (node.type === 'text') {
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            color: node.fontColor ?? '#ffffff',
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
                color: node.fontColor ?? '#ffffff',
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
              onChange={(e) => onTextChange(e.target.value)}
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
            background: node.fill ?? '#6457f0',
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
            background: node.fill ?? '#6457f0',
            borderRadius: '50%',
            border: node.strokeColor ? `${(node.strokeWidth ?? 1) * scale}px solid ${node.strokeColor}` : undefined,
          }}
        />
      );
    }

    return null;
  })();

  return (
    <div
      style={nodeStyle}
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
    >
      {content}
    </div>
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

// Keyboard shortcuts
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

// Re-export to allow SlideCanvas to use keyboard hooks
export { useKeyboardTools };
