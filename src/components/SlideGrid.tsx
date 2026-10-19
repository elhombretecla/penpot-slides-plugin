import { useRef, useState } from 'react';
import { useElementSize } from '../hooks';
import { useSlideStore } from '../store';
import type { Slide } from '../types';
import { SlidePreview } from './SlideCanvas';
import { handleSlideKeys } from './SlideList';

const MIN_CARD = 180;
const GAP = 16;

// Slide sorter: every slide of the deck at once, to review the flow and
// reorder by dragging. Double-click (or Enter) opens a slide in the editor.
export default function SlideGrid() {
  const slides = useSlideStore((s) => s.slides);
  const activeSlideId = useSlideStore((s) => s.activeSlideId);
  const setActiveSlide = useSlideStore((s) => s.setActiveSlide);
  const setEditorView = useSlideStore((s) => s.setEditorView);
  const reorderSlides = useSlideStore((s) => s.reorderSlides);
  const duplicateSlide = useSlideStore((s) => s.duplicateSlide);
  const deleteSlide = useSlideStore((s) => s.deleteSlide);
  const commitHistory = useSlideStore((s) => s.commitHistory);

  const ref = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(ref);
  const inner = Math.max(0, width - GAP * 2);
  const columns = Math.max(1, Math.floor((inner + GAP) / (MIN_CARD + GAP)));
  const cardWidth = Math.floor((inner - GAP * (columns - 1)) / columns);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);

  function open(slide: Slide) {
    setActiveSlide(slide.id);
    setEditorView('canvas');
  }

  function drop() {
    if (dragIndex !== null && insertAt !== null) {
      const to = insertAt > dragIndex ? insertAt - 1 : insertAt;
      if (to !== dragIndex) {
        commitHistory();
        reorderSlides(dragIndex, to);
      }
    }
    setDragIndex(null);
    setInsertAt(null);
  }

  return (
    <div
      ref={ref}
      className="slide-grid"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const slide = slides.find((s) => s.id === activeSlideId);
          if (slide && (e.target as HTMLElement).hasAttribute('data-slide-focus')) {
            e.preventDefault();
            open(slide);
          }
          return;
        }
        handleSlideKeys(e, slides, activeSlideId, columns);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        drop();
      }}
    >
      <div className="slide-grid-inner" style={{ gridTemplateColumns: `repeat(${columns}, ${cardWidth}px)` }}>
        {width > 0 &&
          slides.map((slide, idx) => (
            <div
              key={slide.id}
              className={`slide-grid-card${slide.id === activeSlideId ? ' active' : ''}${dragIndex === idx ? ' is-dragging' : ''}`}
              draggable
              onDragStart={(e) => {
                setDragIndex(idx);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(idx));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                setInsertAt(e.clientX > rect.left + rect.width / 2 ? idx + 1 : idx);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setInsertAt(null);
              }}
            >
              {dragIndex !== null && insertAt === idx && dragIndex !== idx && dragIndex !== idx - 1 && (
                <div className="slide-grid-drop slide-grid-drop--before" />
              )}
              {dragIndex !== null && insertAt === idx + 1 && dragIndex !== idx && dragIndex !== idx + 1 && (
                <div className="slide-grid-drop slide-grid-drop--after" />
              )}
              <button
                className="slide-grid-thumb"
                data-slide-focus
                onClick={() => setActiveSlide(slide.id)}
                onDoubleClick={() => open(slide)}
                title="Double-click to edit"
              >
                <SlidePreview slide={slide} width={cardWidth - 4} />
              </button>
              <div className="slide-grid-meta">
                <span className="slide-grid-number">{idx + 1}</span>
                <span className="slide-grid-name" title={slide.name}>{slide.name}</span>
                <span className="slide-grid-actions">
                  <button
                    className="btn-icon btn-icon-sm"
                    title="Duplicate"
                    onClick={() => {
                      commitHistory();
                      duplicateSlide(slide.id);
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                  <button
                    className="btn-icon btn-icon-sm btn-danger"
                    title="Delete"
                    onClick={() => {
                      commitHistory();
                      deleteSlide(slide.id);
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14H6L5 6" />
                    </svg>
                  </button>
                </span>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
