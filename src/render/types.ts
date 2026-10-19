// A slide as Penpot renders it.
export interface SlideRender {
  key: string; // slideRenderKey of the rendered snapshot
  svg: string; // sanitised markup, top-level shapes tagged with data-node
  frameSig: string;
  nodeSigs: Record<string, string>;
  // Top-level node ids that Penpot rendered, bottom → top.
  nodes: string[];
}
