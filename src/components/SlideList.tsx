import { useRef, useState } from 'react';
import { useElementSize } from '../hooks';
import { useSlideStore } from '../store';
import type { Slide } from '../types';
import { SlidePreview } from './SlideCanvas';

export default function SlideList() {
  const slides = useSlideStore((s) => s.slides);
  const activeSlideId = useSlideStore((s) => s.activeSlideId);
  const setActiveSlide = useSlideStore((s) => s.setActiveSlide);
  const deleteSlide = useSlideStore((s) => s.deleteSlide);
  const duplicateSlide = useSlideStore((s) => s.duplicateSlide);
  const reorderSlides = useSlideStore((s) => s.reorderSlides);
  const commitHistory = useSlideStore((s) => s.commitHistory);

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
      if (to !== dragIndex) {
        commitHistory();
        reorderSlides(dragIndex, to);
      }
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
      onKeyDown={(e) => handleSlideKeys(e, slides, activeSlideId)}
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
          onDelete={() => {
            commitHistory();
            deleteSlide(slide.id);
          }}
          onDuplicate={() => {
            commitHistory();
            duplicateSlide(slide.id);
          }}
          onDragStart={(e) => handleDragStart(idx, e)}
          onDragOver={(e) => handleDragOverItem(e, idx)}
          onDragEnd={handleDragEnd}
        />
      ))}
    </div>
  );
}

// Keyboard on a focused slide: arrows walk the deck, Ctrl+arrows move the
// slide, Delete removes it and Ctrl+D duplicates it (as in Google Slides).
// Shared by the slide strip and the grid view.
export function handleSlideKeys(
  e: React.KeyboardEvent,
  slides: Slide[],
  activeSlideId: string | null,
  columns = 1
) {
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
  const store = useSlideStore.getState();
  const index = slides.findIndex((s) => s.id === activeSlideId);
  if (index === -1) return;
  const mod = e.ctrlKey || e.metaKey;
  const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
  const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
  const step = e.key === 'ArrowUp' || e.key === 'ArrowDown' ? columns : 1;
  let focusIndex: number | null = null;

  if ((back || fwd) && mod) {
    const to = Math.max(0, Math.min(slides.length - 1, index + (fwd ? step : -step)));
    if (to !== index) {
      store.commitHistory();
      store.reorderSlides(index, to);
    }
    focusIndex = to;
  } else if (back || fwd) {
    const to = Math.max(0, Math.min(slides.length - 1, index + (fwd ? step : -step)));
    store.setActiveSlide(slides[to].id);
    focusIndex = to;
  } else if (e.key === 'Home' || e.key === 'End') {
    const to = e.key === 'Home' ? 0 : slides.length - 1;
    store.setActiveSlide(slides[to].id);
    focusIndex = to;
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
    store.commitHistory();
    store.deleteSlide(slides[index].id);
    focusIndex = Math.min(index, slides.length - 2);
  } else if (mod && e.key.toLowerCase() === 'd') {
    store.commitHistory();
    store.duplicateSlide(slides[index].id);
    focusIndex = index + 1;
  } else {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  // Keep the keyboard on the slides once React has re-rendered them.
  const container = e.currentTarget as HTMLElement;
  if (focusIndex !== null && focusIndex >= 0) {
    requestAnimationFrame(() => {
      const items = container.querySelectorAll<HTMLElement>('[data-slide-focus]');
      items[focusIndex!]?.focus();
      items[focusIndex!]?.scrollIntoView({ block: 'nearest' });
    });
  }
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
  const commitHistoryCoalesced = useSlideStore((s) => s.commitHistoryCoalesced);

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
        data-slide-focus
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
          onChange={(e) => {
            commitHistoryCoalesced(`slide:${slide.id}:name`);
            updateSlide(slide.id, { name: e.target.value });
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}

// ─── Slide Thumbnail ──────────────────────────────────────────────────────────

function SlideThumbnail({ slide }: { slide: Slide }) {
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(ref);
  return (
    <div ref={ref} className="slide-thumb" style={{ aspectRatio: `${slide.width} / ${slide.height}` }}>
      {width > 0 && <SlidePreview slide={slide} width={width} />}
    </div>
  );
}
