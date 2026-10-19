import { useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react';
import { loadSvgFonts, sanitizeSvg, scopeSvgIds } from '../render/svg';

interface Props {
  svg: string;
  // data-node groups to hide (nodes the HTML renderer draws instead).
  hiddenNodes?: string[];
  className?: string;
  style?: React.CSSProperties;
}

// Inline Penpot markup, scaled to its box. The markup is only re-parsed when
// it changes; hiding nodes just toggles their display.
export default function SvgView({ svg, hiddenNodes, className, style }: Props) {
  const scope = 'r' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  // Sanitised again here, the only place markup becomes DOM: cached renders
  // may come from older versions of the plugin.
  const html = useMemo(() => ({ __html: scopeSvgIds(sanitizeSvg(svg), scope) }), [svg, scope]);
  const ref = useRef<HTMLDivElement>(null);
  const hiddenKey = (hiddenNodes ?? []).join(',');

  useEffect(() => loadSvgFonts(svg), [svg]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const hidden = new Set(hiddenKey ? hiddenKey.split(',') : []);
    root.querySelectorAll<SVGElement>('[data-node]').forEach((el) => {
      el.style.display = hidden.has(el.getAttribute('data-node') ?? '') ? 'none' : '';
    });
  }, [html, hiddenKey]);

  return <div ref={ref} className={`svg-view ${className ?? ''}`} style={style} dangerouslySetInnerHTML={html} />;
}
