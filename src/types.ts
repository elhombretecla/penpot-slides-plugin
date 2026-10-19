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

  // Template slot: id of the shape inside the template's main component this
  // node comes from (stable across instances, see spike Q4). Nodes the user
  // adds have no slot. Copy/paste drops it; duplicating a slide keeps it.
  slotId?: string;
  role?: SlotRole;
  // The user changed this slot's content (text or image). Only edited slots
  // travel when the slide switches layout; untouched ones take the new
  // template's defaults.
  edited?: boolean;
  // The image was replaced in the editor: `imageUrl` holds the new picture
  // and export uploads it instead of reusing the template's image fill.
  imageReplaced?: boolean;

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
  // Library typography the text style comes from. Export re-applies it with
  // `applyTypography` so the text stays linked to the library style.
  typographyId?: string;
  typographyLibraryId?: string;

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
  // Path geometry (`Path.d`) for vector shapes filled with an image: export
  // recreates the path and its image fill instead of a raster copy.
  pathData?: string;

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
  // Size of the copy when `copyState` was captured; export replays the state
  // at this size and then scales the whole copy to the node's size.
  copyBase?: { width: number; height: number };
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

// 1920×1080 matches Penpot's presentation boards and most slide templates.
export const SLIDE_SIZE_PRESETS: Record<SlideSizePreset, SlideSize> = {
  '16:9': { width: 1920, height: 1080 },
  '4:3':  { width: 1440, height: 1080 },
  'custom': { width: 1920, height: 1080 },
};

export type PresetLayout = 'empty' | 'title-only' | 'title-text' | 'two-columns' | 'image-caption';

// Semantic role of a slot inside a template. Roles are what lets content
// move between layouts ("change layout" keeps the title as the title).
export type SlotRole =
  | 'title'
  | 'subtitle'
  | 'body'
  | 'caption'
  | 'image'
  | 'asset'
  | 'decoration';

// Library component a slide was created from. `componentId` is the template;
// node `slotId`s point at shapes inside its main component.
export interface TemplateRef {
  libraryId: string;
  libraryName?: string;
  componentId: string;
  componentName: string;
  path?: string;
}

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
  // Picture of an image background fill, for the editor preview only.
  backgroundImageUrl?: string;
  nodes: SlideNode[];
  template?: TemplateRef;
  // Free-form speaker notes; stored with the deck and on the Penpot board.
  notes?: string;
}

// ─── Deck (persisted document) ────────────────────────────────────────────────

export const DECK_SCHEMA_VERSION = 2;

export interface Deck {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  // Library used as the deck's theme: its slide components are offered as
  // layouts and its colors / typographies as styles.
  libraryId?: string;
  libraryName?: string;
  slides: Slide[];
  exportSettings?: ExportSettings;
}

export interface DeckSummary {
  id: string;
  name: string;
  slideCount: number;
  updatedAt: number;
  width: number;
  height: number;
  libraryName?: string;
}

// ─── Library & Component info (from plugin side) ──────────────────────────────

export interface LibraryInfo {
  id: string;
  name: string;
  numComponents: number;
  numSlides: number;
  isLocal: boolean;
}

export interface AvailableLibrary {
  id: string;
  name: string;
  numComponents: number;
}

// 'slide': a full-slide layout (big board with a slide-like aspect ratio);
// 'asset': anything else (logos, icons, bullets) — inserted as elements.
export type ComponentKind = 'slide' | 'asset';

export interface ComponentInfo {
  id: string;
  libraryId: string;
  name: string;
  path: string;
  kind: ComponentKind;
  width?: number;
  height?: number;
}

export interface LibraryColorInfo {
  id: string;
  libraryId: string;
  name: string;
  path: string;
  color?: string;
  opacity?: number;
  // Gradient / image library colors are listed but cannot be used as a flat
  // swatch in the editor.
  isFlat: boolean;
}

export interface LibraryTypographyInfo {
  id: string;
  libraryId: string;
  name: string;
  path: string;
  fontId: string;
  fontFamily: string;
  fontVariantId: string;
  fontSize: number;
  fontWeight: string;
  fontStyle?: 'normal' | 'italic';
  lineHeight: number;
  letterSpacing: number;
  textTransform?: 'uppercase' | 'capitalize' | 'lowercase';
}

export interface LibraryCatalog {
  libraryId: string;
  components: ComponentInfo[];
  colors: LibraryColorInfo[];
  typographies: LibraryTypographyInfo[];
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
  libraryName?: string;
  componentName: string;
  path?: string;
  nodes: SlideNode[];
  background: string;
  backgroundFills?: unknown[];
  backgroundImageUrl?: string;
  width: number;
  height: number;
  importedAt: number;
}

export interface ImportJobError {
  componentId: string;
  componentName: string;
  message: string;
}

// What to do with the imported templates once the job completes.
export type ImportPurpose =
  | { kind: 'add-slides'; insertAfterSlideId?: string | null }
  | { kind: 'change-layout'; slideId: string }
  | { kind: 'reset-slide'; slideId: string }
  | { kind: 'cache-only' };

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
  purpose: ImportPurpose;
}

// ─── Export Settings ──────────────────────────────────────────────────────────

export interface ExportSettings {
  spacing: number;
  // true: slides go inside a "Slides deck" flex board; false: each slide is a
  // top-level board (what Penpot's View / presentation mode expects).
  wrapInDeck: boolean;
  createNewPage: boolean;
  slidePrefix: string;
  // Create a prototype flow starting at the first slide so Penpot's View
  // mode can present the deck (only for top-level boards).
  createFlow: boolean;
}

// ─── Message Protocol (UI ↔ Plugin) ──────────────────────────────────────────

export type UIMessage =
  | { type: 'get-libraries' }
  | { type: 'get-available-libraries' }
  | { type: 'connect-library'; libraryId: string }
  | { type: 'get-catalog'; requestId: string; libraryId: string }
  | {
      type: 'get-thumbnails';
      requestId: string;
      libraryId: string;
      // Signatures of the thumbnails the UI already has cached; the plugin
      // only re-renders components whose signature changed.
      known: Record<string, string>;
      force: boolean;
    }
  | { type: 'import-components'; requestId: string; items: ImportItemRequest[] }
  | { type: 'get-asset'; requestId: string; libraryId: string; componentId: string }
  | { type: 'insert-into-canvas'; deckId: string; deckName: string; slides: Slide[]; settings: ExportSettings }
  | { type: 'list-decks' }
  | { type: 'load-deck'; deckId: string }
  | { type: 'save-deck'; requestId: string; deck: string; summary: DeckSummary }
  | { type: 'delete-deck'; deckId: string }
  | { type: 'resize'; width: number; height: number };

export type PluginMessage =
  | { type: 'libraries'; libraries: LibraryInfo[]; fileId: string; fileName: string }
  | { type: 'available-libraries'; libraries: AvailableLibrary[] }
  | { type: 'library-connected'; libraryId: string }
  | { type: 'catalog'; requestId: string; catalog: LibraryCatalog }
  | { type: 'thumbnail'; requestId: string; componentId: string; thumbnail: string; signature: string }
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
      payload: Omit<ImportedComponentPayload, 'importedAt'>;
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
  | { type: 'asset'; requestId: string; node: SlideNode | null; message?: string }
  | { type: 'insert-complete'; count: number; warnings: string[] }
  | { type: 'decks'; decks: DeckSummary[] }
  | { type: 'deck-loaded'; deckId: string; deck: string | null }
  | { type: 'deck-saved'; requestId: string; deckId: string; ok: boolean; message?: string }
  | { type: 'error'; message: string }
  | { type: 'theme'; theme: string };
