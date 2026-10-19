# Slide Builder for Penpot

A slide editor that lives inside Penpot. Build presentations from your own
template library, edit them like in Google Slides, see them exactly as
Penpot renders them, and insert them into the file as linked boards that
you can keep updating — or edit in Penpot and bring back into the editor.

## Features

**Decks from your library**
- Any component library connected to the file is a theme: its slide-sized
  components are the layouts, its colors and text styles are the styles,
  the rest of its components are insertable elements.
- New presentations from a library or blank. "New slide" offers the deck's
  layouts; "Change layout" moves edited text and pictures into the new
  layout's slots by role (title → title…).
- Presentations are saved inside the Penpot file, so they travel with it and
  every collaborator sees them.

**Penpot-accurate editing**
- The canvas shows Penpot's own rendering of each slide (fonts, effects,
  linked components), with an interactive layer on top. Edited elements are
  drawn live until the next render.
- Text editing on the canvas, shapes, pictures from disk, library elements.
- Smart guides and snapping, Shift to lock an axis or keep proportions,
  Alt-drag to duplicate, arrow nudge, align and distribute, context menu,
  stacking order, undo / redo.
- Fonts from Penpot's catalog (Google fonts and your team's fonts) with
  their real weights and styles; library text styles and colors, file color
  tokens, deck and recent colors; save new text styles and colors to the
  file's library.

**Insert, update, read back**
- Each slide is inserted as a board containing a **linked copy** of its
  template: only what you changed is written as an override, so library
  updates keep flowing into the slides. Extra elements go on top.
- Slides are tagged: inserting again **updates the same boards in place**
  (position, page and flow kept; added / removed slides handled).
- **Bring changes from Penpot**: edits made directly on the boards come back
  into the editor.
- Speaker notes travel with the boards; a presentation flow is created for
  Penpot's View mode.

**Presenting and organising**
- Grid view of the whole deck with drag-to-reorder.
- Presentation mode inside the plugin with speaker notes.
- The window button in the top bar makes the plugin fill the browser tab
  (Penpot keeps a 40 px margin) and is remembered for the next opening
  (`allow:localstorage` permission).

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `V` `T` `R` `E` | Select, text, rectangle, ellipse tool |
| `Enter` / `Esc` | Edit the selected text / leave editing, clear the selection |
| Arrows (`Shift` = 10) | Nudge the selection |
| `Ctrl/⌘ C` `X` `V` `D` | Copy, cut, paste (under the pointer), duplicate |
| `Ctrl/⌘ A` | Select all |
| `Ctrl/⌘ ]` `[` (`Shift` = to front / back) | Stacking order |
| `Delete` | Delete the selection |
| `Alt` + drag | Duplicate while moving |
| `Shift` + drag / corner resize | Lock axis / keep proportions |
| `Ctrl/⌘` + drag | Move without snapping |
| `Ctrl/⌘ Z` / `Ctrl/⌘ Shift Z` | Undo / redo |
| `Ctrl/⌘ +` `-` `0`, `Ctrl/⌘` + wheel | Zoom |
| Slide list: arrows, `Ctrl/⌘` arrows, `Delete`, `Ctrl/⌘ D` | Go to, move, delete, duplicate slides |
| `Page Up` / `Page Down` | Previous / next slide |
| Presenting: `→` `Space` / `←`, `Home` `End`, `S`, `F`, `Esc` | Navigate, speaker notes, full screen, exit |

## Install

```bash
npm install
npm run build
```

Serve `dist/` (for example `npx vite preview`, port 4400) and load
`http://localhost:4400/manifest.json` from Penpot's Plugin Manager
(`Ctrl + Alt + P`).

## Development

| Script | What it does |
|---|---|
| `npm run dev` | Rebuild on change (`vite build --watch`); pair it with a static server on port 4400 |
| `npm run build` | Type-check, build `dist/` and check that `plugin.js` is a single classic script (Penpot does not load modules) |
| `npm run check` | Type-check, lint and unit tests |
| `npm test` / `npm run test:watch` | Unit tests (Vitest) |
| `npm run e2e` | Build, then run the browser suites against a mock Penpot host |

The browser suites (`e2e/`) run the real UI in Chrome with a fake plugin
that answers its messages. They need Chrome or Chromium; set `CHROME_PATH`
if it is not found. `node e2e/run.mjs canvas` runs one suite; screenshots
and failure captures go to `e2e/output/`.

The plugin side talks to Penpot and is verified against a real file; the
probes in `spike/` document the API behaviours the design relies on.

## Architecture

```
src/
├── plugin.ts            Penpot sandbox entry: message dispatcher
├── plugin/              Everything that touches the Penpot API
│   ├── persistence.ts     decks stored as shared plugin data in the file
│   ├── libraries.ts       catalog, fonts, color tokens, new library styles
│   ├── import.ts          template components → slide nodes (slots)
│   ├── render.ts          thumbnails and slide renders (generateMarkup)
│   ├── insert.ts          insert / update in place / read back boards
│   ├── slides.ts          linked template copies, overrides, new shapes
│   ├── markup.ts media.ts generateMarkup clean-up, media inlining
│   └── jobs.ts util.ts    one-at-a-time scratch jobs, helpers
├── App.tsx              UI entry: plugin message handling
├── store.ts             Zustand store: deck, slides, selection, history
├── deck.ts              storage format, roles, change layout
├── render/              render cache, scheduling, render plan, SVG helpers
├── canvas/              geometry (snapping, align) and editing commands
├── screens/             home, library gallery, editor
└── components/          canvas, panels, pickers, grid view, presenter…
```

- **Model.** A slide is a template reference plus nodes; nodes that come from
  the template keep a `slotId` (the main component's shape id) and an
  `edited` flag. Only differences from the template are written on insert.
- **Rendering.** The plugin builds the slide off-canvas with the same code
  as "Insert", reads Penpot's SVG markup and removes it. Renders are cached
  by content (memory + IndexedDB) and sanitised before display.
- **Messages.** UI and plugin exchange typed messages (`src/types.ts`,
  `UIMessage` / `PluginMessage`).

## Known Penpot limitations

- Applying a text style resets line height to 1.2 (`applyTypography`); the
  plugin sets it again afterwards, but changing the style later in Penpot
  resets it.
- A linked copy cannot gain children, so elements you add or duplicate are
  placed on top of the template copy, not inside its groups.
- New text styles and colors can only be created in the file's own library.
- Team fonts are previewed with a fallback in the quick preview; the Penpot
  render shows them exactly.

## License

MIT — see [LICENSE](LICENSE).
