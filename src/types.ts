// ─── Slide Node Types ─────────────────────────────────────────────────────────

export type SlideNodeType =
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'group'
  | 'image'
  | 'path'
  | 'component-instance';

export interface SlideNode {
  id: string;
  type: SlideNodeType;
  name: string;

  // Position/size are relative to the parent container:
  //  - Top-level slide nodes are relative to the slide (board) origin.
  //  - Nested nodes (inside a 'group') are relative to the group's origin.
  x: number;
  y: number;
  width: number;
  height: number;

  visible: boolean;
  opacity: number;
  rotation: number;

  // Original Penpot shape type, kept as metadata for debugging / future use.
  sourceType?: string;

  // Text-specific
  text?: string;
  fontSize?: number;
  fontWeight?: string;
  fontColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;

  // Shape-specific (rect / ellipse / path / image background)
  // Convenience fields derived from the first fill/stroke — used by the plugin
  // UI for quick color pickers and previews.
  fill?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  borderRadius?: number;

  // Full fill/stroke arrays captured from Penpot — preserve gradients, image
  // fills, multi-fill stacks and per-fill opacities that the convenience
  // fields above cannot represent. When present these take precedence when
  // writing back to Penpot. Typed as `unknown[]` to keep this module free of
  // the Penpot namespace; the plugin host casts them back to `Fill[]` /
  // `Stroke[]` before applying.
  fills?: unknown[];
  strokes?: unknown[];

  // Image / path / component-instance visual snapshot (base64 PNG data URL).
  // Used so the plugin UI can render elements that are not perfectly modelled
  // as primitives (e.g. vector paths, svg, nested images).
  imageUrl?: string;

  // Group-specific: nested child nodes rendered inside this container.
  children?: SlideNode[];
  // Whether the group acts as a clipping container (boards, masks).
  clipContent?: boolean;

  // Component instance-specific
  libraryId?: string;
  componentId?: string;
  componentName?: string;
}

// ─── Slide ────────────────────────────────────────────────────────────────────

export type SlideSource = 'library-component' | 'custom';

export type SlideSizePreset = '16:9' | '4:3' | 'custom';

export interface SlideSize {
  width: number;
  height: number;
}

export const SLIDE_SIZE_PRESETS: Record<SlideSizePreset, SlideSize> = {
  '16:9': { width: 1280, height: 720 },
  '4:3':  { width: 1024, height: 768 },
  'custom': { width: 800, height: 600 },
};

export type PresetLayout = 'empty' | 'title-only' | 'title-text' | 'two-columns' | 'image-caption';

export interface Slide {
  id: string;
  name: string;
  source: SlideSource;
  width: number;
  height: number;
  background: string;
  // Full backing `fills` array from the source board (gradients, images, etc.)
  // When present this takes precedence over `background` when writing back.
  backgroundFills?: unknown[];
  nodes: SlideNode[];

  // Library component slides
  libraryId?: string;
  componentId?: string;
  componentName?: string;

  // Preview thumbnail (base64 data URL) used while nodes are being extracted
  thumbnailUrl?: string;
  // Whether node extraction is still in progress
  nodesLoading?: boolean;
}

// ─── Library & Component info (from plugin side) ──────────────────────────────

export interface LibraryInfo {
  id: string;
  name: string;
  numComponents: number;
}

export interface ComponentInfo {
  id: string;
  libraryId: string;
  name: string;
  path: string;
  width?: number;
  height?: number;
}

// ─── Import Job ───────────────────────────────────────────────────────────────

export interface ImportItemRequest {
  componentId: string;
  libraryId: string;
  componentName: string;
  width?: number;
  height?: number;
}

export interface ImportedComponentPayload {
  componentId: string;
  libraryId: string;
  componentName: string;
  nodes: SlideNode[];
  background: string;
  backgroundFills?: unknown[];
  width: number;
  height: number;
  importedAt: number;
}

export interface ImportJobError {
  componentId: string;
  componentName: string;
  message: string;
}

export interface ImportJob {
  requestId: string;
  items: ImportItemRequest[];
  total: number;
  done: number;
  failed: number;
  currentComponentName?: string;
  errors: ImportJobError[];
  status: 'running' | 'complete';
}

// ─── Export Settings ──────────────────────────────────────────────────────────

export interface ExportSettings {
  spacing: number;
  groupIntoSection: boolean;
  createNewPage: boolean;
  slidePrefix: string;
}

// ─── Message Protocol (UI ↔ Plugin) ──────────────────────────────────────────

export type UIMessage =
  | { type: 'get-libraries' }
  | { type: 'get-components'; libraryId: string }
  | { type: 'import-components'; requestId: string; items: ImportItemRequest[] }
  | { type: 'insert-into-canvas'; slides: Slide[]; settings: ExportSettings }
  | { type: 'resize'; width: number; height: number };

export type PluginMessage =
  | { type: 'libraries'; libraries: LibraryInfo[] }
  | { type: 'components'; libraryId: string; components: ComponentInfo[] }
  | { type: 'thumbnail'; componentId: string; thumbnail: string }
  | { type: 'thumbnails-complete' }
  | { type: 'import-start'; requestId: string; total: number }
  | {
      type: 'import-progress';
      requestId: string;
      index: number;
      total: number;
      componentId: string;
      componentName: string;
    }
  | {
      type: 'import-item';
      requestId: string;
      componentId: string;
      libraryId: string;
      componentName: string;
      nodes: SlideNode[];
      background: string;
      backgroundFills?: unknown[];
      width: number;
      height: number;
    }
  | {
      type: 'import-item-error';
      requestId: string;
      componentId: string;
      componentName: string;
      message: string;
    }
  | { type: 'import-complete'; requestId: string; success: number; failed: number }
  | { type: 'insert-complete'; count: number }
  | { type: 'error'; message: string }
  | { type: 'theme'; theme: string };
