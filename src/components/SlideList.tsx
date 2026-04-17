import { useRef } from 'react';
import { useSlideStore } from '../store';
import type { Slide } from '../types';

export default function SlideList() {
  const slides = useSlideStore((s) => s.slides);
  const activeSlideId = useSlideStore((s) => s.activeSlideId);
  const setActiveSlide = useSlideStore((s) => s.setActiveSlide);
  const deleteSlide = useSlideStore((s) => s.deleteSlide);
  const duplicateSlide = useSlideStore((s) => s.duplicateSlide);
  const reorderSlides = useSlideStore((s) => s.reorderSlides);

  const dragIndex = useRef<number | null>(null);
  const dragOverIndex = useRef<number | null>(null);

  function handleDragStart(idx: number) {
    dragIndex.current = idx;
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    dragOverIndex.current = idx;
  }

  function handleDrop() {
    const from = dragIndex.current;
    const to = dragOverIndex.current;
    if (from !== null && to !== null && from !== to) {
      reorderSlides(from, to);
    }
    dragIndex.current = null;
    dragOverIndex.current = null;
  }

  return (
    <div className="slide-list" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      {slides.map((slide, idx) => (
        <SlideItem
          key={slide.id}
          slide={slide}
          index={idx}
          isActive={slide.id === activeSlideId}
          onSelect={() => setActiveSlide(slide.id)}
          onDelete={() => deleteSlide(slide.id)}
          onDuplicate={() => duplicateSlide(slide.id)}
          onDragStart={() => handleDragStart(idx)}
          onDragOver={(e) => handleDragOver(e, idx)}
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
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
}

function SlideItem({
  slide,
  index,
  isActive,
  onSelect,
  onDelete,
  onDuplicate,
  onDragStart,
  onDragOver,
}: SlideItemProps) {
  const updateSlide = useSlideStore((s) => s.updateSlide);

  return (
    <div
      className={`slide-item ${isActive ? 'active' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
    >
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

function SlideThumbnail({ slide }: { slide: Slide }) {
  const scale = 160 / slide.width;

  return (
    <div
      className="slide-thumb"
      style={{ background: slide.background }}
    >
      {slide.source === 'library-component' ? (
        <div className="slide-thumb-component-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="8" height="8" rx="1"/>
            <rect x="13" y="3" width="8" height="8" rx="1"/>
            <rect x="3" y="13" width="8" height="8" rx="1"/>
          </svg>
          <span>{slide.componentName ?? slide.name}</span>
        </div>
      ) : (
        <div className="slide-thumb-inner" style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          {slide.nodes.filter((n) => n.visible).map((node) => (
            <div
              key={node.id}
              className="slide-thumb-node"
              style={{
                position: 'absolute',
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
                opacity: node.opacity,
                transform: `rotate(${node.rotation}deg)`,
                ...(node.type === 'text' ? {
                  color: node.fontColor ?? '#ffffff',
                  fontSize: (node.fontSize ?? 16),
                  fontWeight: node.fontWeight ?? '400',
                  textAlign: node.textAlign ?? 'left',
                  overflow: 'hidden',
                  wordBreak: 'break-word',
                  lineHeight: 1.2,
                } : {
                  background: node.fill ?? '#6457f0',
                  borderRadius: node.type === 'ellipse' ? '50%' : (node.borderRadius ?? 0),
                }),
              }}
            >
              {node.type === 'text' && node.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
