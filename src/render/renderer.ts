import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { penpotApi } from '../api';
import { useSlideStore } from '../store';
import type { Slide } from '../types';
import { readRender, writeRender } from '../thumbCache';
import { frameSignature, nodeSignature, slideRenderKey } from './keys';
import { prepareSvg } from './svg';
import type { SlideRender } from './types';

// ─── Render engine (UI side) ─────────────────────────────────────────────────
// The editor shows Penpot's own rendering of each slide. After an edit the
// active slide is re-rendered once the user pauses; the other slides follow
// in the background. Renders are content-addressed (slideRenderKey) and kept
// in memory and IndexedDB, so undo, switching slides or reopening a deck
// reuse them instead of asking Penpot again.

const ACTIVE_DELAY_MS = 450;
const BACKGROUND_DELAY_MS = 1200;
// Generous: a first render may include uploading a large picture.
const REQUEST_TIMEOUT_MS = 60_000;
const MEMORY_LIMIT = 80;
// Enough for a crisp canvas at the usual zooms; originals stay in the deck.
const RENDER_IMAGE_MAX = 1600;
const PREF_KEY = 'slide-builder:penpot-render';

interface RenderState {
  enabled: boolean;
  // Latest render per slide id (may be older than the slide's content).
  renders: Record<string, SlideRender>;
  renderingSlideId: string | null;
  lastError: string | null;
  setEnabled: (enabled: boolean) => void;
}

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export const useRenderStore = create<RenderState>((set) => ({
  enabled: readPref(),
  renders: {},
  renderingSlideId: null,
  lastError: null,
  setEnabled: (enabled) => {
    try {
      localStorage.setItem(PREF_KEY, enabled ? 'on' : 'off');
    } catch {
      // Preference just isn't remembered.
    }
    failedKeys.clear();
    set({ enabled, lastError: null });
  },
}));

// ─── Scheduler ───────────────────────────────────────────────────────────────

interface InFlight {
  requestId: string;
  slideId: string;
  key: string;
  frameSig: string;
  nodeSigs: Record<string, string>;
  timeout: number;
}

const memory = new Map<string, SlideRender>();
const failedKeys = new Set<string>();
let inFlight: InFlight | null = null;
let lookingUp = false;
let timer: number | null = null;
let timerKey: string | null = null;

function remember(render: SlideRender) {
  memory.delete(render.key);
  memory.set(render.key, render);
  if (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value as string);
}

function setRender(slideId: string, render: SlideRender) {
  useRenderStore.setState((s) => ({ renders: { ...s.renders, [slideId]: render } }));
}

function needsRender(slide: Slide): boolean {
  const key = slideRenderKey(slide);
  return useRenderStore.getState().renders[slide.id]?.key !== key && !failedKeys.has(key);
}

function nextTarget(): { slide: Slide; delay: number } | null {
  const { enabled } = useRenderStore.getState();
  const { deck, slides, activeSlideId, screen } = useSlideStore.getState();
  if (!enabled || !deck || screen !== 'slide-manager') return null;
  const active = slides.find((s) => s.id === activeSlideId);
  if (active && needsRender(active)) return { slide: active, delay: ACTIVE_DELAY_MS };
  const other = slides.find(needsRender);
  return other ? { slide: other, delay: BACKGROUND_DELAY_MS } : null;
}

function schedule() {
  if (inFlight || lookingUp) return; // the answer schedules the next one
  const target = nextTarget();
  const key = target ? target.slide.id + ':' + slideRenderKey(target.slide) : null;
  if (key === timerKey && timer != null) return; // same work already queued
  if (timer != null) window.clearTimeout(timer);
  timer = null;
  timerKey = key;
  if (!target) return;
  const slideId = target.slide.id;
  timer = window.setTimeout(() => {
    timer = null;
    timerKey = null;
    void run(slideId);
  }, target.delay);
}

async function run(slideId: string) {
  const slide = useSlideStore.getState().slides.find((s) => s.id === slideId);
  if (!slide || inFlight || !needsRender(slide)) return schedule();
  const key = slideRenderKey(slide);

  lookingUp = true;
  const cached = memory.get(key) ?? (await readRender(key).finally(() => (lookingUp = false)));
  lookingUp = false;
  if (cached) {
    remember(cached);
    setRender(slideId, cached);
    return schedule();
  }

  const requestId = uuidv4();
  inFlight = {
    requestId,
    slideId,
    key,
    frameSig: frameSignature(slide),
    nodeSigs: Object.fromEntries(slide.nodes.map((n) => [n.id, nodeSignature(n)])),
    timeout: window.setTimeout(() => finish(requestId, 'Penpot did not answer in time.'), REQUEST_TIMEOUT_MS),
  };
  useRenderStore.setState({ renderingSlideId: slideId });
  penpotApi.renderSlide(requestId, slide);
}

function finish(requestId: string, error: string | null) {
  if (!inFlight || inFlight.requestId !== requestId) return;
  window.clearTimeout(inFlight.timeout);
  if (error) failedKeys.add(inFlight.key);
  inFlight = null;
  useRenderStore.setState({ renderingSlideId: null, lastError: error });
  schedule();
}

// Plugin answer to `render-slide`.
export async function receiveSlideRender(
  requestId: string,
  svg: string | null,
  shapes: Record<string, string>,
  message?: string
) {
  const job = inFlight;
  if (!job || job.requestId !== requestId) return;
  if (!svg) {
    finish(requestId, message ?? 'Penpot could not render the slide.');
    return;
  }
  try {
    const render: SlideRender = {
      key: job.key,
      svg: await prepareSvg(svg, RENDER_IMAGE_MAX, shapes),
      frameSig: job.frameSig,
      nodeSigs: job.nodeSigs,
      nodes: Object.values(shapes),
    };
    remember(render);
    void writeRender(render);
    if (useSlideStore.getState().slides.some((s) => s.id === job.slideId)) setRender(job.slideId, render);
    finish(requestId, null);
  } catch (err) {
    finish(requestId, err instanceof Error ? err.message : String(err));
  }
}

// A cached render by key (home screen covers).
export async function findRender(key: string): Promise<SlideRender | null> {
  const hit = memory.get(key) ?? (await readRender(key));
  if (hit) remember(hit);
  return hit;
}

export function startRenderer(): () => void {
  const unsubSlides = useSlideStore.subscribe((state, prev) => {
    if (state.deck?.id !== prev.deck?.id) useRenderStore.setState({ renders: {} });
    if (
      state.slides !== prev.slides ||
      state.activeSlideId !== prev.activeSlideId ||
      state.deck !== prev.deck ||
      state.screen !== prev.screen
    ) {
      schedule();
    }
  });
  const unsubRender = useRenderStore.subscribe((state, prev) => {
    if (state.enabled !== prev.enabled) schedule();
  });
  schedule();
  return () => {
    unsubSlides();
    unsubRender();
  };
}
