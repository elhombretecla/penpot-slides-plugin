import { useCallback, useEffect, useRef, useState } from 'react';
import { useElementSize } from '../hooks';
import { useSlideStore } from '../store';
import { SlidePreview } from './SlideCanvas';

const CONTROLS_HIDE_MS = 2200;

// Presentation mode inside the plugin: one slide at a time, scaled to fit,
// with keyboard / click navigation and the speaker notes on demand.
export default function Presenter() {
  const slides = useSlideStore((s) => s.slides);
  const index = useSlideStore((s) => s.presenting);
  const setPresenting = useSlideStore((s) => s.setPresenting);
  const setActiveSlide = useSlideStore((s) => s.setActiveSlide);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stage = useElementSize(stageRef);
  const [showNotes, setShowNotes] = useState(false);
  const [controls, setControls] = useState(true);
  const hideTimer = useRef<number | undefined>(undefined);

  const current = index === null ? null : slides[Math.min(index, slides.length - 1)];
  const last = slides.length - 1;

  const go = useCallback(
    (to: number) => setPresenting(Math.max(0, Math.min(last, to))),
    [last, setPresenting]
  );

  const exit = useCallback(() => {
    // Back in the editor on the slide that was showing.
    if (current) setActiveSlide(current.id);
    setPresenting(null);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, [current, setActiveSlide, setPresenting]);

  const poke = useCallback(() => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControls(false), CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => {
    rootRef.current?.focus();
    poke();
    return () => window.clearTimeout(hideTimer.current);
  }, [poke]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      // While presenting no key reaches the editor (no stray undo / delete).
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      let handled = true;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter' || k === 'n' || k === 'N') go(index + 1);
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace' || k === 'p' || k === 'P') go(index - 1);
      else if (k === 'Home') go(0);
      else if (k === 'End') go(last);
      else if (k === 'Escape') exit();
      else if (k === 's' || k === 'S') setShowNotes((v) => !v);
      else if (k === 'f' || k === 'F') toggleFullscreen(rootRef.current);
      else handled = false;
      if (handled) e.preventDefault();
    };
    // Capture: the editor's own shortcuts must not see these keys.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, last, go, exit]);

  if (index === null || !current) return null;

  const fit = stage.width > 0 ? Math.min(stage.width / current.width, stage.height / current.height) : 0;
  const notes = current.notes?.trim();

  return (
    <div
      ref={rootRef}
      className={`presenter${controls ? '' : ' presenter--idle'}`}
      tabIndex={-1}
      onMouseMove={poke}
    >
      <div
        ref={stageRef}
        className="presenter-stage"
        onClick={(e) => {
          // Left fifth goes back, the rest forward (like a clicker).
          const rect = e.currentTarget.getBoundingClientRect();
          go(e.clientX < rect.left + rect.width / 5 ? index - 1 : index + 1);
        }}
      >
        {fit > 0 && (
          <div key={current.id} className="presenter-slide" style={{ width: current.width * fit, height: current.height * fit }}>
            <SlidePreview slide={current} width={current.width * fit} />
          </div>
        )}
      </div>

      {showNotes && (
        <div className="presenter-notes body-s">{notes || <span className="presenter-notes-empty">No speaker notes for this slide</span>}</div>
      )}

      <div className="presenter-controls" onMouseMove={(e) => e.stopPropagation()} onMouseEnter={() => window.clearTimeout(hideTimer.current)}>
        <button className="presenter-btn" onClick={() => go(index - 1)} disabled={index === 0} title="Previous (←)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span className="presenter-count">{index + 1} / {slides.length}</span>
        <button className="presenter-btn" onClick={() => go(index + 1)} disabled={index === last} title="Next (→, Space)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
        </button>
        <span className="presenter-sep" />
        <button className={`presenter-btn${showNotes ? ' active' : ''}`} onClick={() => setShowNotes((v) => !v)} title="Speaker notes (S)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 5h16M4 10h16M4 15h10" /></svg>
        </button>
        {document.fullscreenEnabled && (
          <button className="presenter-btn" onClick={() => toggleFullscreen(rootRef.current)} title="Full screen (F)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          </button>
        )}
        <button className="presenter-btn" onClick={exit} title="Exit (Esc)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  );
}

function toggleFullscreen(el: HTMLElement | null) {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else el?.requestFullscreen?.().catch(() => {});
}
