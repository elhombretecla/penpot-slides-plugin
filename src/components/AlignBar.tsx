import { useSlideStore } from '../store';
import type { Slide } from '../types';
import { dropDominatedIds } from '../canvas/commands';
import {
  alignMoves,
  distributeMoves,
  placeNodes,
  unionBox,
  type AlignMode,
  type DistributeMode,
  type PlacedBox,
} from '../canvas/geometry';

const ALIGN: Array<{ mode: AlignMode; title: string; icon: React.ReactNode }> = [
  { mode: 'left', title: 'Align left', icon: <><line x1="4" y1="3" x2="4" y2="21" /><rect x="7" y="6" width="12" height="4" rx="1" /><rect x="7" y="14" width="7" height="4" rx="1" /></> },
  { mode: 'hcenter', title: 'Align horizontal centers', icon: <><line x1="12" y1="3" x2="12" y2="21" /><rect x="5" y="6" width="14" height="4" rx="1" /><rect x="8" y="14" width="8" height="4" rx="1" /></> },
  { mode: 'right', title: 'Align right', icon: <><line x1="20" y1="3" x2="20" y2="21" /><rect x="5" y="6" width="12" height="4" rx="1" /><rect x="10" y="14" width="7" height="4" rx="1" /></> },
  { mode: 'top', title: 'Align top', icon: <><line x1="3" y1="4" x2="21" y2="4" /><rect x="6" y="7" width="4" height="12" rx="1" /><rect x="14" y="7" width="4" height="7" rx="1" /></> },
  { mode: 'vcenter', title: 'Align vertical centers', icon: <><line x1="3" y1="12" x2="21" y2="12" /><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="8" width="4" height="8" rx="1" /></> },
  { mode: 'bottom', title: 'Align bottom', icon: <><line x1="3" y1="20" x2="21" y2="20" /><rect x="6" y="5" width="4" height="12" rx="1" /><rect x="14" y="10" width="4" height="7" rx="1" /></> },
];

const DISTRIBUTE: Array<{ mode: DistributeMode; title: string; icon: React.ReactNode }> = [
  { mode: 'horizontal', title: 'Distribute horizontal spacing', icon: <><line x1="3" y1="3" x2="3" y2="21" /><line x1="21" y1="3" x2="21" y2="21" /><rect x="9" y="7" width="6" height="10" rx="1" /></> },
  { mode: 'vertical', title: 'Distribute vertical spacing', icon: <><line x1="3" y1="3" x2="21" y2="3" /><line x1="3" y1="21" x2="21" y2="21" /><rect x="7" y="9" width="10" height="6" rx="1" /></> },
];

// Align the selection to its own bounds (to the slide for one element) and
// spread three or more elements evenly.
export default function AlignBar({ slide }: { slide: Slide }) {
  const selectedNodeIds = useSlideStore((s) => s.selectedNodeIds);
  const moveNodes = useSlideStore((s) => s.moveNodes);
  const commitHistory = useSlideStore((s) => s.commitHistory);

  const ids = new Set(dropDominatedIds(slide.nodes, selectedNodeIds));
  const boxes: PlacedBox[] = placeNodes(slide.nodes).filter((p) => ids.has(p.id));
  if (boxes.length === 0) return null;
  const frame = boxes.length === 1 ? { x: 0, y: 0, width: slide.width, height: slide.height } : unionBox(boxes)!;

  function apply(moves: Map<string, { dx: number; dy: number }>) {
    if (moves.size === 0) return;
    commitHistory();
    moveNodes(slide.id, moves);
  }

  const icon = (body: React.ReactNode) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      {body}
    </svg>
  );

  return (
    <div className="align-bar" role="toolbar" aria-label="Align">
      {ALIGN.map((a) => (
        <button
          key={a.mode}
          className="align-bar-btn"
          title={boxes.length === 1 ? `${a.title} (to slide)` : a.title}
          onClick={() => apply(alignMoves(boxes, frame, a.mode))}
        >
          {icon(a.icon)}
        </button>
      ))}
      <span className="align-bar-divider" />
      {DISTRIBUTE.map((d) => (
        <button
          key={d.mode}
          className="align-bar-btn"
          title={boxes.length < 3 ? `${d.title} (select 3 or more)` : d.title}
          disabled={boxes.length < 3}
          onClick={() => apply(distributeMoves(boxes, d.mode))}
        >
          {icon(d.icon)}
        </button>
      ))}
    </div>
  );
}
