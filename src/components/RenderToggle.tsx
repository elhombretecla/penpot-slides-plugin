import { useMemo } from 'react';
import type { Slide } from '../types';
import { planRender } from '../render/plan';
import { useRenderStore } from '../render/renderer';

// Switch between Penpot's own rendering and the quick HTML preview, with
// the state of the active slide's render.
export default function RenderToggle({ slide }: { slide: Slide | null }) {
  const enabled = useRenderStore((s) => s.enabled);
  const setEnabled = useRenderStore((s) => s.setEnabled);
  const render = useRenderStore((s) => (slide ? s.renders[slide.id] : undefined));
  const busy = useRenderStore((s) => !!slide && s.renderingSlideId === slide.id);
  const error = useRenderStore((s) => s.lastError);
  const fresh = useMemo(() => !!slide && !!planRender(slide, render)?.fresh, [slide, render]);

  const status = !enabled ? 'off' : fresh || !slide ? 'idle' : busy || !error ? 'rendering' : 'error';
  const title = {
    off: 'Penpot render is off: the canvas uses the quick HTML preview. Click to turn it on.',
    idle: 'The canvas shows Penpot\'s own rendering of this slide — what "Insert" will produce. Click to turn it off.',
    rendering: 'Updating Penpot\'s rendering of this slide… Recent edits are shown with the quick preview meanwhile.',
    error: `Penpot could not render this slide (${error ?? 'unknown error'}). Showing the quick preview.`,
  }[status];

  return (
    <button
      data-appearance="secondary"
      className="render-toggle"
      onClick={() => setEnabled(!enabled)}
      title={title}
      aria-pressed={enabled}
    >
      <span className={`render-dot render-dot--${status}`} />
      Penpot render
    </button>
  );
}
