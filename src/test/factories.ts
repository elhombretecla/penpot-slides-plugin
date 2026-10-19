import type { Slide, SlideNode } from '../types';

// Minimal valid nodes and slides for unit tests.
export function node(id: string, patch: Partial<SlideNode> = {}): SlideNode {
  return { id, type: 'rect', name: id, x: 0, y: 0, width: 100, height: 50, visible: true, opacity: 1, rotation: 0, ...patch };
}

export function slide(id: string, nodes: SlideNode[], patch: Partial<Slide> = {}): Slide {
  return { id, name: id, source: 'custom', width: 1920, height: 1080, background: '#ffffff', nodes, ...patch };
}
