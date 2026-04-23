import { useState } from 'react';
import { useSlideStore } from '../store';
import type { Slide } from '../types';
import { fillsToCss, firstFillColor } from '../utils';

export default function SlideList() {
  const slides = useSlideStore((s) => s.slides);
  const activeSlideId = useSlideStore((s) => s.activeSlideId);
  const setActiveSlide = useSlideStore((s) => s.setActiveSlide);
  const deleteSlide = useSlideStore((s) => s.deleteSlide);
  const duplicateSlide = useSlideStore((s) => s.duplicateSlide);
  const reorderSlides = useSlideStore((s) => s.reorderSlides);

  // React state (not refs) so the indicator line and drag-ghost styles can
  // re-render in response to the gesture.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // Insertion index in the pre-drag array — the slot where the dragged slide
  // would land if the user dropped right now. Between 0 and slides.length.
  const [insertAt, setInsertAt] = useState<number | null>(null);

  function handleDragStart(idx: number, e: React.DragEvent) {
    setDragIndex(idx);
    // Without a dataTransfer payload, Firefox refuses to start the drag.
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }

  function handleDragOverItem(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Pick "insert above" vs "insert below" from the mouse position within
    // the hovered item — mirrors the VS Code / Figma panel behaviour.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const after = e.clientY > midpoint;
    setInsertAt(after ? idx + 1 : idx);
  }

  function handleListDragLeave(e: React.DragEvent) {
    // Only clear when the pointer actually leaves the list (not when it just
    // crosses into a nested child — that also fires dragleave on the parent).
    const related = e.relatedTarget as Node | null;
    if (related && (e.currentTarget as Node).contains(related)) return;
    setInsertAt(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    commitReorder();
  }

  function commitReorder() {
    if (dragIndex !== null && insertAt !== null) {
      // Array-move semantics: splice-remove shifts downstream indices by -1,
      // so an insert point past the source needs to subtract 1.
      const to = insertAt > dragIndex ? insertAt - 1 : insertAt;
      if (to !== dragIndex) reorderSlides(dragIndex, to);
    }
    setDragIndex(null);
    setInsertAt(null);
  }

  function handleDragEnd() {
    // Covers the case where the user releases outside any item (cancel).
    setDragIndex(null);
    setInsertAt(null);
  }

  return (
    <div
      className="slide-list"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={handleListDragLeave}
    >
      {slides.map((slide, idx) => (
        <SlideItem
          key={slide.id}
          slide={slide}
          index={idx}
          isActive={slide.id === activeSlideId}
          isDragging={dragIndex === idx}
          showIndicatorAbove={insertAt === idx && dragIndex !== null && dragIndex !== idx && dragIndex !== idx - 1}
          showIndicatorBelow={insertAt === idx + 1 && dragIndex !== null && dragIndex !== idx && dragIndex !== idx + 1}
          onSelect={() => setActiveSlide(slide.id)}
          onDelete={() => deleteSlide(slide.id)}
          onDuplicate={() => duplicateSlide(slide.id)}
          onDragStart={(e) => handleDragStart(idx, e)}
          onDragOver={(e) => handleDragOverItem(e, idx)}
          onDragEnd={handleDragEnd}
        />
      ))}
    </div>
  );
}

// ─── Slide Item ───────────────────────────────────────────────────────────────

interface SlideItemProps {
  slide: Slide;
  index: number;
  isActive: boolean;
  isDragging: boolean;
  showIndicatorAbove: boolean;
  showIndicatorBelow: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function SlideItem({
  slide,
  index,
  isActive,
  isDragging,
  showIndicatorAbove,
  showIndicatorBelow,
  onSelect,
  onDelete,
  onDuplicate,
  onDragStart,
  onDragOver,
  onDragEnd,
}: SlideItemProps) {
  const updateSlide = useSlideStore((s) => s.updateSlide);

  const className =
    `slide-item${isActive ? ' active' : ''}${isDragging ? ' is-dragging' : ''}`;

  return (
    <div
      className={className}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      {showIndicatorAbove && <div className="slide-drop-indicator slide-drop-indicator--above" />}
      {showIndicatorBelow && <div className="slide-drop-indicator slide-drop-indicator--below" />}
      <span className="slide-number">{String(index + 1).padStart(2, '0')}</span>

      <button
        className="slide-thumbnail-btn"
        onClick={onSelect}
        title={slide.name}
      >
        <SlideThumbnail slide={slide} />
      </button>

      {/* Slide action buttons visible on hover */}
      <div className="slide-item-actions">
        <button
          className="btn-icon btn-icon-sm"
          onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          title="Duplicate"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
        <button
          className="btn-icon btn-icon-sm btn-danger"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
          </svg>
        </button>
      </div>

      {/* Editable name */}
      {isActive && (
        <input
          className="slide-name-input"
          value={slide.name}
          onChange={(e) => updateSlide(slide.id, { name: e.target.value })}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}

// ─── Slide Thumbnail ──────────────────────────────────────────────────────────

import type { SlideNode } from '../types';

function flattenLeaves(
  nodes: SlideNode[],
  offsetX = 0,
  offsetY = 0
): Array<SlideNode & { absX: number; absY: number }> {
  const out: Array<SlideNode & { absX: number; absY: number }> = [];
  for (const n of nodes) {
    if (!n.visible) continue;
    const absX = offsetX + n.x;
    const absY = offsetY + n.y;
    if (n.type === 'group') {
      // Emit a background rect for clipped groups whose fills resolve to
      // something renderable (solid, gradient or multi-fill stack).
      const hasFillsBg = n.clipContent && (fillsToCss(n.fills) ?? n.fill);
      if (hasFillsBg) {
        out.push({ ...n, absX, absY });
      }
      if (n.children && n.children.length > 0) {
        out.push(...flattenLeaves(n.children, absX, absY));
      }
      continue;
    }
    out.push({ ...n, absX, absY });
  }
  return out;
}

function SlideThumbnail({ slide }: { slide: Slide }) {
  const scale = 160 / slide.width;

  const thumbContent = () => {
    if (slide.nodesLoading) {
      if (slide.thumbnailUrl) {
        return (
          <img
            src={slide.thumbnailUrl}
            alt={slide.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            draggable={false}
          />
        );
      }
      return (
        <div className="slide-thumb-component-label">
          <div className="spinner spinner--sm" />
        </div>
      );
    }

    const leaves = flattenLeaves(slide.nodes);

    return (
      <div className="slide-thumb-inner" style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {leaves.map((node) => {
          const baseStyle: React.CSSProperties = {
            position: 'absolute',
            left: node.absX,
            top: node.absY,
            width: node.width,
            height: node.height,
            opacity: node.opacity,
            transform: `rotate(${node.rotation}deg)`,
          };

          if (node.type === 'text') {
            return (
              <div
                key={node.id}
                className="slide-thumb-node"
                style={{
                  ...baseStyle,
                  color: firstFillColor(node.fills) ?? node.fontColor ?? '#ffffff',
                  fontSize: node.fontSize ?? 16,
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
                {node.text}
              </div>
            );
          }

          if (node.type === 'image' || node.type === 'path' || node.type === 'component-instance') {
            if (node.imageUrl) {
              return (
                <img
                  key={node.id}
                  src={node.imageUrl}
                  alt={node.name}
                  draggable={false}
                  style={{ ...baseStyle, objectFit: 'contain' }}
                />
              );
            }
            return (
              <div
                key={node.id}
                className="slide-thumb-node"
                style={{
                  ...baseStyle,
                  background: fillsToCss(node.fills) ?? node.fill ?? 'rgba(100,87,240,0.2)',
                }}
              />
            );
          }

          const nodeBg = fillsToCss(node.fills) ?? node.fill ?? '#6457f0';
          const stroke =
            node.strokeColor && node.strokeWidth
              ? `${node.strokeWidth}px solid ${node.strokeColor}`
              : undefined;
          return (
            <div
              key={node.id}
              className="slide-thumb-node"
              style={{
                ...baseStyle,
                background: nodeBg,
                border: stroke,
                borderRadius: node.type === 'ellipse' ? '50%' : (node.borderRadius ?? 0),
              }}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div
      className="slide-thumb"
      style={{ background: fillsToCss(slide.backgroundFills) ?? slide.background }}
    >
      {thumbContent()}
    </div>
  );
}
