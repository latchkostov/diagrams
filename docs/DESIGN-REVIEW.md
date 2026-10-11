# Design review (Phase 3)

Reviewed 2026-10-11 in Chrome at 1440×900, 1920×1080 and 1024×768, dark and light: Gallery, Canvas
(every public example), Lab, context menus, inspector and presentation mode. Cursors were audited
with a script that walks every visible element and compares `getComputedStyle(el).cursor` with what
the element does (click, drag, edit, copy).

Screenshots: `docs/screenshots/design-before-*.png` (before) and `design-after-*.png` (after).

## What's great

- **The node is the hero.** Card, compact and icon renderers are crisp in both themes, brand accents
  carry colour, and the chrome stays out of the way. Keep this restraint.
- **Type and rhythm.** Mona Sans with a little width (`font-stretch: 106–112%`) on headings and
  Geist Mono for ids and sublabels gives a confident, technical voice without shouting.
- **Dark mode depth.** Inset top highlights plus long soft shadows read as real elevation.
- **Menus.** The context menu is keyboard-complete, edge-aware and searchable. It's now reused by
  the gallery (tile menu, vendor menu).
- **Editor affordances.** Handles fade in on hover, a dashed connection line, and grouped dragging
  all feel considered.

## What was off (and is now fixed in the design lane)

| Issue                                                                        | Fix                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 31 vendor chips in one scrolling row: overwhelming, and it doesn't scale     | Seven **families** in one quiet segmented track (All, Azure, AWS, Google Cloud, Kafka & streaming, Open source, SaaS, Generic & clients) with live counts, plus a **Vendor** menu (families, then vendors, searchable) for the long tail. Mapping in `src/lib/vendorFamilies.ts`.                                                                                                              |
| Search matched a description substring, so "sb" or "pg" found nothing useful | Ranked search over label, vendor, id, role, category, family and an alias table (`src/lib/stencilSearch.ts`): "sb" finds Service Bus, "pg" Postgres, "k8s" Kubernetes, "lambda" puts AWS Lambda first. Two-letter tokens must start a word.                                                                                                                                                    |
| Gallery tiles only displayed                                                 | Tiles open a **details drawer** (all three node variants, description, sim role explained, id/accent copy, icon source and licence, add / new diagram / copy JSON, ←/→ to step). Tiles **drag** (grab cursor; a drop dock appears, and dropping into an editor pastes a JSON node), have a hover **+** quick add, and an app **context menu** (Add, View details, Copy id, Copy as JSON node). |
| Text cursor and accidental selection everywhere                              | Lead's global defaults plus a full pass (table below).                                                                                                                                                                                                                                                                                                                                         |
| Light-mode `--text-3` was 3.1:1 on white; dark 3.5:1                         | Now about 4.6:1 in both themes. `--text-4` added for placeholders and decorative counts only.                                                                                                                                                                                                                                                                                                  |
| Platform scrollbars with arrows inside panels                                | Thin, theme-coloured scrollbars app-wide.                                                                                                                                                                                                                                                                                                                                                      |
| Disabled controls kept the arrow or pointer                                  | `not-allowed`, plus consistent 45% opacity on `.btn` / `.icon-btn`.                                                                                                                                                                                                                                                                                                                            |
| No press states                                                              | Buttons, rail links, family chips, palette rows and section headers get a pressed tone (and `.btn` a half-pixel drop).                                                                                                                                                                                                                                                                         |
| "Loading…" flashed on every view switch                                      | Views fade in; the loading note only appears after 350 ms.                                                                                                                                                                                                                                                                                                                                     |
| Canvas palette was one long list                                             | Search first (Enter adds the top hit), family filter, collapsible categories (remembered), **Recently used** pinned on top (also shown in the collapsed rail).                                                                                                                                                                                                                                 |

### Cursor model (now enforced)

| Element                                                             | Cursor                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------- |
| Buttons, links, selects, checkboxes, menu buttons                   | `pointer`                                                     |
| Gallery tiles, palette items, recent tiles                          | `grab` / `grabbing`                                           |
| Canvas nodes, boundary labels, multi-selection box                  | `move`                                                        |
| Empty canvas, minimap                                               | `grab` / `grabbing` (pans)                                    |
| Node handles                                                        | `crosshair`                                                   |
| Edges and edge labels                                               | `pointer`                                                     |
| Stencil ids, accent hex and other copy chips                        | `copy`                                                        |
| Disabled controls                                                   | `not-allowed` (menu items keep the arrow, as native menus do) |
| Inputs, textareas, search fields (whole field), the Lab's share URL | `text`                                                        |
| Everything else                                                     | `default`, no text selection                                  |

Covered by e2e: `gallery.spec.ts` (tiles grab, ids copy, nothing in the gallery shows `text`),
`palette.spec.ts` (items grab, nodes move).

## Prioritised recommendations for other lanes

**P0**

1. **Top bar overflows below ~1100px** (Import/Export lane, `TopBar.tsx`). At 1024 the bar scrolls
   sideways and Export, Present and the theme toggle fall off-screen. Below 1280 fold the Node and
   Edge pickers into one "View" menu button (reuse `ContextMenu` with checked items); below 1100 make
   Import/Export icon-only (the `.label-optional` class already exists in `app.css`).
2. **Diagrams fit too small with both panels open** (Live lane, `CanvasView.tsx`). At 1440 the Kafka
   example fits at about 50% and at 1024 about 30%, where labels are unreadable. Suggest: start the
   inspector collapsed when nothing is selected and the window is under 1440px (open it on
   selection), keep the palette collapsed under 1280px, and lower the `FIT` top padding from 150px
   to about 110px.
3. **Confirm actions with a toast** (Import/Export lane: `App.tsx` or `src/interop/ui/toast.tsx`).
   "Add to current diagram" switches views silently. Expose a tiny `notify(text, action?)` event so
   the Gallery and canvas can say "Added Amazon SQS to Kafka order pipeline" with Undo. The gallery
   then drops its own `.gallery-note`.

**P1**

4. **Real "New diagram"** (Import/Export lane). The gallery's "New diagram with this" writes the
   imported-diagram slot and reloads (`openNewDiagramWith` in `src/lib/canvasBridge.ts`) because
   `App` only reads the imported diagram on start. It asks before replacing an existing imported
   diagram. Replace with a storage API (`createDiagram(seed)`) plus App re-reading its options on
   `popstate`/`storage`, then delete the reload.
5. **Prefix labels on the top-bar selects** (Import/Export lane). "Node" and "Edge" look clickable
   but clicking the prefix doesn't open the select. Stretch the `<select>` over the whole label or
   switch to a menu button.
6. **Minimap size** (Live lane, `canvas.css`). It's about 220×160 and covers nodes at 1024. Use 168×112
   and hide it below 1100px, or make it toggle-only.
7. **Inspector polish** (lead / editor lane, `Inspector.tsx`). "1 boundaries" needs pluralising.
   The 14px section padding and 32px fields make it the densest-looking surface. Try 28px fields and
   12px gaps, and render the node id as a `copy-chip` (the class is global now).
8. **One label style** (Lab lane and `ContextMenu.tsx`). The Lab sidebar and inspector use tracked
   ALL CAPS headings ("NODES", "CONTROLS"), and so does `.cm-header`. Everywhere else uses sentence
   case at 12px/600 in `--text-3`. Use one style.

**P2**

9. **Native `title` tooltips on nodes** (`canvas/nodes/variants.tsx`) pop up the description after a
   delay on every hover over the canvas, which feels like a web page. Drop them on the canvas
   (the inspector shows the description) or replace them with a designed tooltip.
10. **Empty-canvas copy** (`CanvasView.tsx`) says "Drag a stencil from the left" even when the
    palette is collapsed. Say "Open the stencil panel or double-click to add one" in that case.

## Tokens added (`src/styles/tokens.css`)

For the Live view (all theme-aware):

| Token                                                                     | Use                                                                          |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `--status-up`, `--status-paused`, `--status-down`                         | Node status ink (dot, ring, label)                                           |
| `--status-up-soft`, `--status-paused-soft`, `--status-down-soft`          | Status backgrounds / badges                                                  |
| `--success`, `--warning`, `--danger` (+ `-soft`), `--info`, `--info-soft` | Expectations pass/fail, alerts                                               |
| `--live-backlog`, `--live-dlq`, `--live-throughput`                       | Metric colours (backlog = paused amber, DLQ = down red, throughput = accent) |
| `--particle-core`, `--particle-glow-blur`, `--particle-glow-opacity`      | Particle centre and glow; particle hue stays the stencil accent              |

General:

| Token                                           | Use                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| `--text-4`                                      | Placeholders, decorative counts. Never body text.                                      |
| `--focus-ring`                                  | Box-shadow ring for custom focus (tiles); `:focus-visible` outlines now use `--accent` |
| `--hover`, `--press`                            | Translucent overlays for rows, chips and quiet buttons                                 |
| `--surface-raised`, `--shadow-1/2/3`, `--scrim` | Elevation: cards, popovers, drawers                                                    |
| `--ease-out`, `--dur-1/2/3`                     | Motion (120/180/260 ms). The global reduced-motion rule turns animation off.           |
| `--sp-1` … `--sp-9`                             | 4px spacing scale (4–48)                                                               |

New global classes: `.btn-ghost`, `.icon-btn-quiet`, `.btn-danger-solid`, `.btn.is-pressed`,
`.field-clear`, `.copy-chip`, and `label.field` (the whole field focuses its input).

## Cross-lane hooks I added (small, isolated)

- `src/lib/canvasBridge.ts`: the Gallery queues stencil ids in `sessionStorage` and switches to the
  canvas with `history.pushState` + a `popstate` event (the existing URL-state hook picks it up).
  The canvas **palette** drains the queue 260 ms after mount, once React Flow has fitted the view,
  and records the open diagram's slug so "current diagram" means the last one you had open.
  There are no edits to `CanvasView.tsx` or `App.tsx`. `STENCIL_DND_MIME` lives here now; `Palette.tsx`
  re-exports it.
- Cursor-only rule edits in `canvas.css` (controls/inspector disabled buttons, group label, an
  appended "cursors" block) and `lab.css` (disabled buttons, share URL).
