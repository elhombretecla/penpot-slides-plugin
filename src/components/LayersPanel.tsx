import { useSlideStore } from '../store';
import type { Slide, SlideNode } from '../types';

interface Props { slide: Slide | null; }

export default function LayersPanel({ slide }: Props) {
  const selectedNodeIds = useSlideStore((s) => s.selectedNodeIds);
  const selectNode = useSlideStore((s) => s.selectNode);
  const updateNode = useSlideStore((s) => s.updateNode);
  const deleteNode = useSlideStore((s) => s.deleteNode);
  const reorderNode = useSlideStore((s) => s.reorderNode);

  if (!slide) {
    return (
      <div className="layers-panel empty">
        <p className="panel-empty-msg">No slide selected</p>
      </div>
    );
  }

  const nodes = [...slide.nodes].reverse();

  return (
    <div className="layers-panel">
      {nodes.length === 0 ? (
        <div className="layers-empty">
          <p className="panel-empty-msg">No layers yet. Add shapes or text to this slide.</p>
        </div>
      ) : (
        <div className="layer-list">
          {nodes.map((node, idx) => (
            <LayerItem
              key={node.id}
              node={node}
              isSelected={selectedNodeIds.includes(node.id)}
              onSelect={() => selectNode(node.id)}
              onToggleVisibility={() => updateNode(slide.id, node.id, { visible: !node.visible })}
              onDelete={() => deleteNode(slide.id, node.id)}
              onMoveUp={() => reorderNode(slide.id, node.id, 'up')}
              onMoveDown={() => reorderNode(slide.id, node.id, 'down')}
              isFirst={idx === 0}
              isLast={idx === nodes.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface LayerItemProps {
  node: SlideNode;
  isSelected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function LayerItem({ node, isSelected, isFirst, isLast, onSelect, onToggleVisibility, onDelete, onMoveUp, onMoveDown }: LayerItemProps) {
  return (
    <div className={`layer-item ${isSelected ? 'active' : ''} ${!node.visible ? 'hidden' : ''}`}>
      <span className="layer-type-icon">{getNodeIcon(node)}</span>

      <button className="layer-name" onClick={onSelect}>
        {node.name}
      </button>

      <div className="layer-actions">
        <button className="btn-icon btn-icon-xs" onClick={onToggleVisibility} title={node.visible ? 'Hide' : 'Show'}>
          {node.visible ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          )}
        </button>
        <button className="btn-icon btn-icon-xs" onClick={onMoveUp} disabled={isFirst} title="Move Up">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button className="btn-icon btn-icon-xs" onClick={onMoveDown} disabled={isLast} title="Move Down">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <button className="btn-icon btn-icon-xs btn-icon-danger" onClick={onDelete} title="Delete">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

function getNodeIcon(node: SlideNode) {
  switch (node.type) {
    case 'text': return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>
      </svg>
    );
    case 'rect': return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
      </svg>
    );
    case 'ellipse': return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="12" cy="12" rx="10" ry="7"/>
      </svg>
    );
    case 'component-instance': return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/>
        <rect x="3" y="13" width="8" height="8" rx="1"/>
      </svg>
    );
  }
}
