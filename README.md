# Slide Builder for Penpot

A full-featured presentation builder plugin for Penpot. Create, edit, and export slides directly into your Penpot canvas — without leaving the workspace.

## Features

- **Slide Manager**: Visual editor with a slide list, interactive canvas, and properties panel — laid out like a simplified Google Slides / Canva
- **Library Import**: Browse connected shared libraries, pick components as slide templates, and add them to your presentation with multi-selection
- **Custom Slides**: Create slides from scratch with preset sizes (16:9, 4:3, Custom) and 5 built-in layout templates (Empty, Title Only, Title + Text, Two Columns, Image + Caption)
- **Shape Tools**: Add and draw rectangles, ellipses, and text blocks directly on the canvas with keyboard shortcuts (`V`, `T`, `R`, `E`)
- **Properties Panel**: Edit text content, typography (size, weight, color, alignment), fill color, opacity, position, dimensions, rotation, and border radius
- **Layers Panel**: Reorder, show/hide, and delete layers per slide
- **Drag & Drop Reorder**: Drag slides in the slide list to rearrange the presentation order
- **Export to Canvas**: Insert all slides as Penpot boards, arranged horizontally with configurable spacing — each named `Slide 01`, `Slide 02`, etc.
- **Export Options**: Control spacing between boards, group slides into a section, or create a new page
- **Penpot Theme Sync**: Automatically adapts to Penpot's light and dark theme using `@penpot/plugin-styles`

## How to Use

1. **Open the plugin** in Penpot via the Plugin Manager (`Ctrl + Alt + P`) using the manifest URL
2. **Start a new presentation** — click "New Presentation" to open the slide creation modal, choose a size, background color, and layout preset
3. **Import from Library** — browse connected shared libraries, select components as slide templates, and click "Add Selected"
4. **Edit your slides** — select a slide from the left panel, then use the canvas toolbar to add shapes and text; edit properties in the right panel
5. **Reorder slides** — drag slides in the left list to reorder them
6. **Export** — click "Export" in the top bar, set your options (spacing, grouping, page), and click "Insert into Canvas" to push all slides as boards to the Penpot canvas

## Technical Details

- Built with **React 19** + **TypeScript** and **Vite**
- **Zustand** for state management (slides, nodes, library data, export settings)
- Uses the official Penpot Plugin API (`@penpot/plugin-types`) for all canvas operations
- Styled exclusively with `@penpot/plugin-styles` — zero hardcoded colors, full dark/light theme support
- Communication between UI and plugin sandbox via typed `postMessage` protocol
- No external runtime UI dependencies

## Architecture

```
src/
├── plugin.ts          # Penpot sandbox — all Penpot API calls (createBoard, createText, etc.)
├── types.ts           # TypeScript types & slide data model
├── store.ts           # Zustand global state
├── api.ts             # Typed postMessage bridge (UI → plugin)
├── utils.ts           # Slide/node factory helpers
├── main.tsx           # React entry point
├── App.tsx            # Root app + message listener
├── style.css          # Layout CSS using @penpot/plugin-styles tokens
├── screens/
│   ├── HomeScreen.tsx       # Entry screen with recent sessions and library list
│   ├── LibraryPicker.tsx    # Component browser with search, filters, and multi-select
│   └── SlideManager.tsx     # Main 4-panel editor (nav / slide list / canvas / properties)
└── components/
    ├── SlideList.tsx         # Drag-to-reorder slide list with thumbnails
    ├── SlideCanvas.tsx       # Interactive canvas with shape/text drawing tools
    ├── PropertiesPanel.tsx   # Node and slide properties editor
    ├── LayersPanel.tsx       # Layers with visibility toggle and reorder
    ├── NewSlideModal.tsx     # Slide creation dialog with size and layout presets
    └── ExportPanel.tsx       # Export settings + "Insert into Canvas" CTA
```

## Installation

```bash
# Install dependencies
npm install

# Build for production
npm run build
```

In Penpot, open the Plugin Manager (`Ctrl + Alt + P`) and load:

```
http://localhost:4400/manifest.json
```

## Development

```bash
# Development mode (watch + live reload)
npm run dev

# Production build
npm run build
```

The dev server runs at `http://localhost:4400`. Open Penpot, load the plugin via the Plugin Manager, and changes rebuild automatically.

## Data Model

Each slide is stored as a plain object:

```ts
interface Slide {
  id: string;
  name: string;
  source: 'library-component' | 'custom';
  width: number;
  height: number;
  background: string;
  nodes: SlideNode[];        // shapes and text layers
  // only for library-component slides:
  libraryId?: string;
  componentId?: string;
  componentName?: string;
}
```

Nodes support types: `text`, `rect`, `ellipse`, and `component-instance`.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
