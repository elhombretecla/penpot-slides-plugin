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
  // Penpot font identity — `fontFamily` alone is ambiguous (team fonts,
  // variants). Export resolves the font through `penpot.fonts` with these.
  fontId?: string;
  fontVariantId?: string;
  fontStyle?: 'normal' | 'italic';
  textTransform?: 'uppercase' | 'capitalize' | 'lowercase';
  textDecoration?: 'underline' | 'line-through';
  verticalAlign?: 'top' | 'center' | 'bottom';
  growType?: 'fixed' | 'auto-width' | 'auto-height';

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

  // Image / path / component-instance visual snapshot (data URL — SVG for
  // vectors, PNG for raster fallbacks). Used so the plugin UI can render
  // elements that are not modelled as primitives (paths, svg, nested images).
  imageUrl?: string;
  // Vector source captured with `penpot.generateMarkup` for paths / svg /
  // booleans. Export recreates real vectors from it via `createShapeFromSvg`
  // instead of flattening them into empty rectangles.
  svgMarkup?: string;

  // Group-specific: nested child nodes rendered inside this container.
  children?: SlideNode[];
  // Whether the group acts as a clipping container (boards, masks).
  clipContent?: boolean;

  // Component instance-specific
  libraryId?: string;
  componentId?: string;
  componentName?: string;
  // Snapshot of the copy's descendants (depth-first order). Templates often
  // override nested instances (a white logo on a dark slide) and scale them;
  // a fresh `instance()` has neither, so export replays this state on it.
  copyState?: CopyStateEntry[];
}

export interface CopyStateEntry {
  // Offset from the instance root origin, in slide units.
  dx: number;
  dy: number;
  width: number;
  height: number;
  rotated: boolean;
  hidden: boolean;
  fills?: unknown[];
  strokes?: unknown[];
  characters?: string;
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
  // Non-fatal problems (skipped elements, flattened components…).
  warnings: string[];
  status: 'running' | 'complete';
}

// ─── Export Settings ──────────────────────────────────────────────────────────

export interface ExportSettings {
  spacing: number;
  // true: slides go inside a "Slides deck" flex board; false: each slide is a
  // top-level board (what Penpot's View / presentation mode expects).
  wrapInDeck: boolean;
  createNewPage: boolean;
  slidePrefix: string;
}

// ─── Message Protocol (UI ↔ Plugin) ──────────────────────────────────────────

export type UIMessage =
  | { type: 'get-libraries' }
  | {
      type: 'get-components';
      requestId: string;
      libraryId: string;
      // Thumbnails the UI already has — the plugin skips re-exporting them.
      knownThumbnailIds: string[];
    }
  | { type: 'import-components'; requestId: string; items: ImportItemRequest[] }
  | { type: 'insert-into-canvas'; slides: Slide[]; settings: ExportSettings }
  | { type: 'resize'; width: number; height: number };

export type PluginMessage =
  | { type: 'libraries'; libraries: LibraryInfo[] }
  | { type: 'components'; requestId: string; libraryId: string; components: ComponentInfo[] }
  | { type: 'thumbnail'; requestId: string; componentId: string; thumbnail: string }
  | { type: 'thumbnails-complete'; requestId: string }
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
      // Elements that could not be read and were left out of the slide.
      warnings: string[];
    }
  | {
      type: 'import-item-error';
      requestId: string;
      componentId: string;
      componentName: string;
      message: string;
    }
  | { type: 'import-complete'; requestId: string; success: number; failed: number }
  | { type: 'insert-complete'; count: number; warnings: string[] }
  | { type: 'error'; message: string }
  | { type: 'theme'; theme: string };
