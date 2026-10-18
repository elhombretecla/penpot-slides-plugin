# Phase 0 — API verification spike

Throw-away probes that check the Penpot Plugin API behaviours the v2
architecture ("template + overrides") depends on. They are not part of the
build (`tsconfig` only includes `src/`).

## How to run

Each file is the **body of an async function** that returns a JSON report.

- **Penpot MCP**: paste the file content into `execute_code`.
- **Plugin console**: wrap it as `(async () => { /* file */ })().then(console.log)`.

Open a file that has the slide-template library available. Probes 2 and 3
create temporary shapes at (-100000, -100000) and remove them when done; the
library's main components are never modified.

| Probe | Mutates? | Answers |
|---|---|---|
| `01-environment.js` | no | API version, libraries, slide-sized components, `mainInstance()` availability, colors/typographies/tokens |
| `02-zorder-plugindata.js` | temp shapes | `children` order, `appendChild`/`insertChild(0)`, coords, shared plugin data, flows, rotation drift |
| `03-template-overrides.js` | temp instance | linked copy, slot mapping via `componentRefShape()`, text/color/image overrides, fonts, export latency |

## Results — run 2026-10-18

Environment: design.penpot.app **2.18.4**, file `[LIBRARY TEMPLATE] Penpot slides`
(13 slide templates 1920×1080 under `0-Slides/`, 8 assets under `1-Assets/`,
8 colors, 10 typographies, 0 token sets, no variants). Template used: `0-Slides/about`.

| # | Question | Result |
|---|---|---|
| Q1 | z-order | ✅ `children` is **bottom→top** (last = front). `appendChild` puts the new shape **on top**; `insertChild(0)` at the bottom. ⇒ the current exporter's reverse loop **inverts** z-order (bug). |
| Q2 | `mainInstance()` / `export()` | ✅ `mainInstance()` works for all 21 local components. ⚠️ `export()` is **server-side and slow**: PNG@0.2 = 4.7 s, PNG@1 = 16.3 s; SVG export fails (`http error`). Not usable as a live renderer; OK for a one-off fallback. |
| Q3 | Linked copy + overrides | ✅ `comp.instance()` (32 ms) returns a board that `isComponentCopyInstance()`, `component().id === template`. After overriding `characters`, `fills` (library color) and an image fill it is **still linked**; main untouched. `clone()` keeps link + overrides (⇒ duplicate slide). |
| Q4 | Stable slot ids | ✅ Every descendant has `componentRefShape()` (0 missing) and the ref ids are **identical across instances** ⇒ usable as `SlotId`. Template `about`: 4 text slots, 2 image slots, 2 nested component instances (`componentHead()`). |
| Q5 | Text override keeps style | ✅ Setting `characters` keeps `fontId`, size, weight, `growType` and the **linked library color** (`fillColorRefId/RefFile`). Per-character run scan with `getRange` costs ~0.3 ms/char. Template had no multi-style text — re-test when one exists. |
| Q6 | Fonts | ✅ `penpot.fonts.findById('gfont-work-sans')` resolves with all 18 variants. Template fonts are `gfont-*` (Google Fonts). ⚠️ Team-uploaded fonts not tested (none in file); they cannot be loaded from Google Fonts. |
| Q7 | Live render budget | ✅ **`penpot.generateMarkup([shape], {type:'svg'})` is client-side: 44–73 ms.** Text overrides appear in the markup after **~1 s** (text layout is async; 300 ms was not enough). Must use an **instance on the current page** — the main component (on another page) renders *without text*. |
| Q8 | SVG fidelity | ✅ Rendered in plain Chrome, the generated SVG matches Penpot's own export (layout, gradients, logos, clip, text positions) once (a) Google Fonts are loaded for `gfont-*` families and (b) image URLs are inlined. Image fills: `ImageData.data()` → bytes in ~8 ms. ⚠️ 2 of 4 images (path-shaped fills not exposed in `fills`) can't be read: sandbox `fetch` returns 200 but only exposes `text()/json()`; asset URLs are 404 without session. Fallback: rasterize that shape once with `export()` and cache by media id. |
| Q9 | Shared plugin data | ✅ Round-trips on boards and pages. ⚠️ Page keys can't be deleted, only set to `''`. |
| Q10 | Flows | ✅ `page.createFlow(name, board)` / `removeFlow()` work on a top-level board. |
| Q11 | Permissions | ⏳ Pending: must be re-checked inside **our** plugin (the MCP plugin has its own permissions): `availableLibraries`/`connectLibrary`, sandbox `fetch`. |
| Q12 | `library.connected` | ⚠️ New: returns **~140 libraries with 0 components** (plus the file's own library). The current plugin filters by `components.length > 0`, which would hide a library whose components are loaded lazily. ⏳ Re-test from a *consumer* file that has the template library connected. |
| — | Rotation | ⚠️ Setting `rotation` after `x/y` rotates around the centre and `x/y` become the rotated bounding box (drift of ~3/22 px for 100×40 @30°). Irrelevant for v2 (no geometry rebuilds), relevant for phase-1 fixes. |

## Decisions for v2

1. **Render engine** = `generateMarkup` SVG of a temporary instance on the
   current page (+ inlined images + Google Fonts), debounced ~1 s after edits,
   with an HTML overlay for instant typing feedback. `export()` only as a cached
   fallback for unreadable images and for nothing interactive.
2. **Slot id** = `componentRefShape().id`.
3. **Insert** = `comp.instance()` per slide; overrides via `characters`,
   `fills` (`LibraryColor.asFill()` keeps the link), image fills; duplicates via `clone()`.
4. **Z-order** = model array order == Penpot `children` order (bottom→top);
   append in natural order.
5. **Persistence** = shared plugin data on slide boards + page.
