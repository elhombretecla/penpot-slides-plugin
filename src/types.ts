// ─── Slide Node Types ─────────────────────────────────────────────────────────

export type SlideNodeType = 'text' | 'rect' | 'ellipse' | 'component-instance';

export interface SlideNode {
  id: string;
  type: SlideNodeType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  opacity: number;
  rotation: number;

  // Text-specific
  text?: string;
  fontSize?: number;
  fontWeight?: string;
  fontColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;

  // Shape-specific
  fill?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  borderRadius?: number;

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
  nodes: SlideNode[];

  // Library component slides
  libraryId?: string;
  componentId?: string;
  componentName?: string;
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
  | { type: 'insert-into-canvas'; slides: Slide[]; settings: ExportSettings }
  | { type: 'resize'; width: number; height: number };

export type PluginMessage =
  | { type: 'libraries'; libraries: LibraryInfo[] }
  | { type: 'components'; libraryId: string; components: ComponentInfo[] }
  | { type: 'insert-complete'; count: number }
  | { type: 'error'; message: string }
  | { type: 'theme'; theme: string };
