# Design review

## Round 3: UX gate after Inputs & capacity, the command palette and Your diagrams

Reviewed 2026-10-11 against `docs/UX-PRINCIPLES.md` on a production build (`pnpm build && pnpm preview`,
so private examples never load), in Chrome at 1920×1080, 1440×900 and 1024×768, dark and light. Four
personas walked the real app:

1. **First-time visitor:** the start card, the library and the examples.
2. **Engineer:** builds `Kafka Topic → Go / Java / Node.js` from a blank canvas with Ctrl+K only (add a
   stencil, `@` to select a node, add the next one connected downstream), then saves, renames and finds
   the diagram again in Your diagrams.
3. **Capacity planner:** "I have 5k msg/s into orders and 3 services. Where's my bottleneck?"
4. **Presenter:** share link → present → live → scrub back → narration.

Menus were counted with a script that opens each context menu and reads its rows. Overlap was measured
with `getBoundingClientRect` on the bar, the panels, the event log and the narration card.

Screenshots: `docs/screenshots/ux-gate3-before-*.png` and `ux-gate3-after-*.png`.

### Scorecard

Scores are out of 5. "Before" is the app at the start of this round. Round 2 ended at 4–4.5
everywhere; the new features pulled several of those back.

| Principle                       | Before | After | Why                                                                                                                                                                                                                                                            |
| ------------------------------- | :----: | :---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Beautiful by default         |   4    |  4.5  | One look at Inputs turned the heat map on for good, so every diagram (edit mode too) wore rings, chips and a callout. Now the panel shows it for that session only; only an explicit toggle is remembered.                                                     |
| 2. Progressive disclosure       |  3.5   |  4.5  | The stencil rail opened all 155 stencils. A first visit now opens Messaging only, so the rail reads as eight categories with counts. Search ignores folding.                                                                                                   |
| 3. Context over chrome          |   4    |  4.5  | "Where does traffic enter?" offers **Traffic into X** inside the panel, instead of sending the planner off to find a source stencil.                                                                                                                           |
| 4. One primary action / surface |   4    |   4   | Unchanged. Save is the panel's primary action; Apply fix stays the callout's one action.                                                                                                                                                                       |
| 5. Budget the chrome            |  3.5   |  4.5  | The canvas menu had reached its 12-item cap. The File menu showed two identical save rows. The Inputs panel repeated the heat-map toggle. All three are back under budget (table below).                                                                       |
| 6. No dead ends                 |   3    |  4.5  | Two dead ends: the panel said "No sources or traffic yet." with no way on, and "Edited, reset" on your own diagram reset it to blank. Both are fixed.                                                                                                          |
| 7. Consistent names             |  3.5   |  4.5  | The palette said "Toggle live" where the toggle says Go live / Back to editing. "Save as…" sat next to an identical "Save to device…". The principles now define the Inputs and capacity words.                                                                |
| 8. App, not page                |  4.5   |  4.5  | Unchanged. Library, palette and dialogs are keyboard-complete; Esc backs out one level.                                                                                                                                                                        |
| 9. Teach in place               |   4    |  4.5  | Ctrl+K was taught only in the shortcuts sheet. The stencil rail's footer now names it. The palette teaches `>` `@` `+` once, with its footer chips, not twice.                                                                                                 |
| 10. Nothing overlaps            |  2.5   |  4.5  | At 1440 and below the event log sat on play / pause. At 1024 the live bar ran under the Inputs panel, hiding ⋯ and squeezing the simulation name to 1px. Narration focus went under the panel. Opening the stencil rail pushed nodes under the inspector rail. |
| 11. Presentation first-class    |  3.5   |  4.5  | The leaked heat map put "Healthy: every service has headroom" over an outage story. The scrubber got 120px of an 820px bar at 1920; it now gets 194px.                                                                                                         |

### Chrome count

| Surface                            | Before                                                             | After                                                        | Budget |
| ---------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ | ------ |
| Top bar                            | 7                                                                  | 7                                                            | ~7     |
| Live bar                           | 10, overflows at 1024 with a panel open                            | The same 10, shedding readouts by width (never overflows)    | 1 row  |
| Live side panels open at once      | 1 (Inputs or simulations) + event log + narration; inspector folds | Same; the log sits above the bar, narration refits beside it |        |
| Canvas right-click, edit / live    | 12 / 9                                                             | 11 / 8 (Show capacity moved under Show ▸)                    | ≤ 12   |
| File menu (no file bound)          | 10, with "Save as…" duplicating "Save to device…"                  | 9 ("Save as…" appears once there's a file to save to)        | ≤ 12   |
| Inputs & capacity panel            | Heat-map switch + presets + rows                                   | Switch removed (−1)                                          |        |
| Ways to toggle the heat map        | 4: View menu, right-click, C, panel switch                         | 3: View menu, Show ▸ Capacity, C                             |        |
| Ways to open Inputs & capacity     | 2: live bar Inputs, callout "Inputs…"                              | 2 (unchanged)                                                |        |
| Stencil rail rows on a first visit | 155 + 8 headers                                                    | 25 + 8 headers                                               |        |
| Palette prefix hints               | Placeholder and footer                                             | Footer chips only                                            |        |

Net: four fewer always-visible or menu-level controls. One contextual control was added (Traffic into
X). It appears only when a diagram has no entry point, and it replaces a dead-end sentence.

### Findings

**P0 (all fixed)**

1. **The event log covered play / pause** at 1440 and below: both sat at `bottom: 18px` on the left.
   The log now sits above the bar. Covered by `live.spec.ts` (live overlap, 1024 and 1440).
2. **The live bar ran under the Inputs panel at 1024.** The ⋯ menu was hidden and the simulation picker
   shrank to 1px. The bar is now a size container that sheds readouts in this order:
   - "In flight" goes first while a simulation runs (the scrubber shows progress).
   - Then the clock and the Inputs label.
   - Then the expectation dots (the Done badge still reports them).

   The picker keeps 112px. Covered by the same e2e test.

3. **The capacity planner hit a dead end.** When traffic enters at a processor or a topic (for example
   `Order API → orders → 3 services`), the diagram has no source. The panel then said "No sources or
   traffic yet." and the callout said "Set a rate on an entry point", but there wasn't one to set.

   Now the panel asks **Where does traffic enter?** and lists up to three root nodes as **Traffic into
   X**. One click adds an "Incoming traffic" source in front of X, connected to it, as one undoable edit.
   It brings the node into view and puts the cursor in its msg/s field. The planner types `5k` and sees
   the bottleneck with Apply fix: three actions, well under a minute. Covered by `capacity.spec.ts`.

4. **Opening Inputs once turned the heat map on everywhere, for good:** in edit mode, on every diagram
   and in presentation. Now opening the panel shows the heat map for that live session only
   (`capacityOverlay.showForSession`). Leaving live view or reloading restores the remembered choice.
   Only View › Show capacity, Show ▸ Capacity and C change that choice. Covered by `capacity.spec.ts`.

**P1 (fixed)**

5. **"Edited, reset" on your own diagrams** threw away all your work, because a blank diagram's original
   is empty. It now shows only on examples and shared diagrams; undo covers your own.
6. **Narration focus went under the Inputs panel** when the panel opened during a note. The camera now
   refits to the note's focus beside the panel.
7. **Opening or closing the stencil rail pushed nodes under the inspector rail.** Toggling either side
   panel now refits the diagram, if the whole of it was in view (a fit, not a view you panned or zoomed).
8. **File menu: "Save as…" duplicated "Save to device…"** until a file was bound: both opened the same
   picker. "Save as…" now appears once there's a file. Ctrl+Shift+S always works.
9. **The canvas menu sat at its 12-item cap** after "Show capacity" was added. It now lives under
   **Show ▸ Capacity (C)**, with Grid, Snap, Minimap and Inspector. The palette finds it as "Show ›
   Capacity" or by searching "heat map".
10. **The Inputs panel repeated the heat-map switch.** The panel shows the heat map while it's open, so
    the switch is gone.
11. **The scrubber was starved in presentation:** 120px at 1920. With "in flight" shed while a
    simulation runs, it's 194px.
12. **Palette words:** "Toggle live" is now **Go live** / **Back to editing**, the toggle's own words.
    The placeholder no longer repeats the footer's `>` `@` `+` chips.
13. **Ctrl+K wasn't taught in place.** The stencil rail's footer now reads "Drag onto the canvas or click
    to add. Ctrl+K finds anything; ? lists shortcuts." It replaces the double-click tip, which is still
    in the shortcuts sheet.
14. **The catalogue nearly doubled, from 81 to 155 stencils.** A first visit opens only the first
    category (Messaging). The gallery's family track, category sidebar and section headers absorbed the
    growth unchanged. The details drawer now credits Simple Icons, Devicon and theSVG for the 15 new
    icons that showed "gilbarbara/logos".

**Verified, no change needed**

- **Start card:** still calm, with one job. Your diagrams come first (the three most recent, then
  "All"), then examples with real thumbnails, then Start blank / Open / Paste.
- **Your diagrams:** Rename, Duplicate and Delete have the same names everywhere, and the picker follows
  a rename at once. A blank diagram joins the library on its first edit.
- **Scrub-back:** dragging the scrubber back replays deterministically to the same note.
- **Panels:** Inputs and the simulation editor are mutually exclusive, and the inspector folds while
  live. The capacity panel starts below the Live toggle.

**P1 and P2 moved to the backlog**

- P1 The bottleneck callout is a static plan. While the timeline has Payments down, it still says
  "Healthy: every service has headroom". It should account for nodes that are down or paused in the run.
- P2 Timeline markers (notes, chaos) aren't clickable. Presenters could jump to one with a click.
- P2 On a blank diagram "Untitled diagram" shows three times: picker, title card and inspector. The title
  card could wait for the first node.
- P2 The diagram card's "15 nodes, 15 edges" repeats the inspector's counts.
- P2 Your diagrams always shows the storage meter. It could wait until storage is half full.
- P2 At 1024 the gallery's family track scrolls behind a fade. Below 1100px, fold the last families into
  the Vendor menu.
- P2 The narration card can still cover dimmed, unfocused nodes. It should prefer free space (from round 2).

### What changed, in numbers

- **Removed or merged:**
  - the Inputs panel's heat-map switch
  - "Show capacity" from the top level of the canvas menu (merged into Show ▸)
  - "Save as…" before a file is bound
  - the prefix hints in the palette placeholder
  - "Edited, reset" on your own diagrams
  - the persisted heat map after opening Inputs
- **Renamed:** Toggle live → Go live / Back to editing. Show capacity on the diagram → Show ▸ Capacity.
- **Moved:** the event log, above the bar.
- **Added:**
  - "Where does traffic enter?" with Traffic into X (only when there's no entry point)
  - a refit when a side panel toggles over a fitted view
  - a refit to a note's focus when a panel opens
  - responsive shedding in the live bar
  - credits for three more icon sets

### Round 2 follow-up

| Round 2 item                                            | Status                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| P1 Keep the selection in view when the inspector opens  | Resolved before this round (`useKeepSelectionInView`); no regression. |
| P1 "Your diagram" is one slot                           | Resolved: the Your diagrams library; every Open or Import adds one.   |
| P1 Picker label doesn't follow title edits              | Resolved; verified with Rename in Your diagrams.                      |
| P1 Live bar picker says "Free play" while editing a sim | Resolved (editing a simulation runs it).                              |
| P2 React Flow attribution under the live bar            | Resolved (lifted while live).                                         |
| P2 Narration card covers neighbouring nodes             | Improved (placement avoids the panel); still in the backlog.          |
| P2 "Story & chaos"                                      | Resolved: Timeline.                                                   |
| P2 Start-card thumbnails                                | Resolved: rendered thumbnails.                                        |
| P2 "Continuous traffic" icon differs                    | Not regressed; left as is.                                            |

## Round 2: UX gate after the live, interop and routing batch

Reviewed 2026-10-11 against `docs/UX-PRINCIPLES.md`, in Chrome at 1920×1080, 1440×900 and 1024×768,
dark and light, on a production build (so private examples never appear). The app was walked as three
personas:

1. **First-time visitor** from latchkostov.com: understand it and make a diagram in about a minute.
2. **Engineer**: add nodes, connect them, set a consumer group and a DLQ, add a boundary, run a storm,
   save and share.
3. **Presenter**: open a share link straight into presentation and live with a saved simulation, step
   through the narration, recover when something goes wrong.

Menus were counted with a script that opens every context menu and reads its rows. Cursors were
re-audited with the round 1 script (no regressions).

Screenshots: `docs/screenshots/ux-gate-before-*.png` and `ux-gate-after-*.png`.

### Scorecard

Scores are out of 5.

| Principle                       | Before | After | Why                                                                                                                                                    |
| ------------------------------- | :----: | :---: | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Beautiful by default         |   4    |  4.5  | Below 1680px the inspector waits for a selection, so examples fit about 1.4× larger at 1440. A blank canvas is calm: no empty minimap, no Live toggle. |
| 2. Progressive disclosure       |  2.5   |   4   | The inspector showed 10 node fields and 9 edge fields at once. Simulation tuning, routing and raw properties now sit behind collapsed sections.        |
| 3. Context over chrome          |   3    |   4   | Live menus lead with live actions. The canvas menu no longer repeats the File menu.                                                                    |
| 4. One primary action / surface |  3.5   |   4   | The start card has one job (pick a way in). The live bar lost its second exit button.                                                                  |
| 5. Budget the chrome            |  2.5   |   4   | Canvas menu 14 → 11 items (live 17 → 9), node menu 13 → 10 (live 12 + a submenu → 6). Every menu level is now within 12.                               |
| 6. No dead ends                 |   2    |   4   | There was no way to start a blank diagram, and the first screen was the stencil catalogue. Now: a start card, File > New diagram, and Undo on replace. |
| 7. Consistent names             |  2.5   |   4   | One word per idea (below). Right-click and File menu items share names.                                                                                |
| 8. App, not page                |  3.5   |  4.5  | Native `title` tooltips on nodes are replaced by an app tooltip. Esc now backs out of live view.                                                       |
| 9. Teach in place               |   3    |   4   | A one-time hint (right-click, L), live keys in the shortcuts sheet, and a Live toggle tooltip that names the saved simulations.                        |
| 10. Nothing overlaps            |   3    |   4   | The simulation panel covered the Live toggle; it now starts below it. Two side panels no longer squeeze the canvas at 1440. Two P2s remain (below).    |
| 11. Presentation first-class    |   4    |   4   | Unchanged and good: a share link opens straight into presentation and live, notes wait for Space, Esc steps out one level at a time.                   |

### Chrome count

| Surface                              | Before                                  | After                             | Budget |
| ------------------------------------ | --------------------------------------- | --------------------------------- | ------ |
| Top bar (canvas)                     | 7                                       | 7                                 | ~7     |
| Live bar                             | 6 controls, one row                     | 5, one row                        | 1 row  |
| Canvas right-click (edit / live)     | 14 / 17                                 | 11 / 9                            | ≤ 12   |
| Node right-click (edit / live)       | 13 / 12 + "Simulation" submenu          | 10 / 6, live actions at top level | ≤ 12   |
| Edge right-click (edit / live)       | 9 / 10                                  | 9 / 3                             | ≤ 12   |
| File menu (top level / formats)      | 7 / 8 (with Save as and Embed misfiled) | 9 / 5                             | ≤ 12   |
| Inspector, node, fields shown        | 10 + raw properties                     | 5 + 2 collapsed sections          |        |
| Inspector, edge, fields shown        | 9 + raw properties                      | 4 + "Advanced"                    |        |
| Inspector open with nothing selected | always at ≥ 1440                        | only at ≥ 1680 (or by hand)       |        |
| Ways to leave live view              | Live toggle, L, × in the bar            | Live toggle, L, Esc               |        |
| Ways to export                       | 2, with different names                 | 2, same names                     |        |

### Findings

**P0 (all fixed)**

1. **The first screen was the stencil catalogue** ("Gallery"), not a diagram. A visitor saw 81 cards
   and no obvious start. Now the bare URL opens the canvas. The tabs read **Diagram | Stencils**,
   diagram first.
2. **No way to start a blank diagram** (persona 2 dead end). Added **File > New diagram** (with an
   Undo toast when it replaces work) and a **start card** on any empty diagram: the five public
   examples (each with three of its stencils as a preview), **Start blank** (opens the stencil panel
   with the cursor in its search), **Open a file…** and **Paste text…** (draw.io, Mermaid or JSON).
   The picker always lists **Your diagram** first, then **Examples**.
3. **The canvas right-click repeated the File menu** under different names ("Save…", "Import ▸",
   "PNG image", "Image… PNG / SVG"), pushing it to 14 items. Save and Import are gone from the
   right-click (File menu, Ctrl+S, Ctrl+O). **Export ▸** stays, with File-menu names.
4. **Live menus buried live actions** one level down under "Simulation" and kept 12 editing items.
   Live menus now lead with the live actions (Inject, Start a storm here…, Behaviour, Kill) under a
   "Live" header, followed by Rename and Properties only. The rest returns in edit mode (L).
5. **Esc didn't leave live view.** Esc now backs out one level at a time: menu, dialog, selection,
   trace, presentation, then live view.
6. **Two side panels squeezed the canvas at 1440** (about 50% of the width; labels unreadable).
   Below 1680px the inspector opens on selection, and **Diagram properties** is on the canvas
   right-click.

**P1 (fixed)**

7. **Inspector density.** Node: Stencil, Label, Subtitle, Boundary and the id as a **copy chip**.
   **Simulation** and **Custom properties** are collapsed sections that remember being opened. Edge:
   Label, Kind, Consumer group and Dead-letter path. Sides, travel time, filter, rename and raw
   properties are under **Advanced**. Fields are 28px (was 32), and sections have 12px padding.
   "1 boundaries" is now pluralised everywhere (inspector, diagram card).
8. **Sentence case everywhere.** Context-menu headers, Lab headings, the narration card, simulation
   editor sections, the lag breakdown and the Paused pill no longer use tracked capitals.
9. **Native `title` tooltips on nodes** are replaced by a designed tooltip (full label, subtitle, what
   the stencil is) after a 550ms hover. It's off while live (badges have their own detail).
10. **The empty-canvas hint ignored the palette.** It now says "open the stencil panel on the left"
    when the panel is collapsed. It's only shown after Start blank, since the start card covers
    the rest.
11. **The simulation panel covered the Live toggle**, the way out of live view. It now starts below it.
12. **The live bar had two exits** (× and the Live toggle). The × is gone.
13. **Live toggle discoverability.** The tooltip names the saved simulations ("replay 2 saved
    simulations"). The one-time hint says the same and retires on dismiss, on the first right-click
    or on going live.
14. **Terminology** (one word per idea):

    | Was                                          | Now                       |
    | -------------------------------------------- | ------------------------- |
    | Gallery / Canvas tabs                        | Stencils / Diagram        |
    | Group into boundary, Group (inspector)       | Add boundary              |
    | Ungroup                                      | Remove boundary           |
    | Delete with contents                         | Delete boundary and nodes |
    | Tone                                         | Colour                    |
    | Sublabel, Edit sublabel                      | Subtitle, Edit subtitle   |
    | Reset simulation (menu) vs Restart (bar)     | Restart                   |
    | "Simulation" menu header (the mode is Live)  | Live                      |
    | Imported: X / your imported diagram          | Your diagram              |
    | More formats (holding Save as and Embed)     | Export as (formats only)  |
    | PNG image (right-click) vs Export PNG (File) | Export PNG                |

    "Live" is the mode, and a "simulation" is a saved, scripted run you replay in it.

15. **Shortcuts sheet** gains a "Live and presenting" group (L, Space, Esc).
16. Removed from the node menu: **Copy id** (now the inspector chip), and **Bring to front / Send to
    back** (still on multi-selections; layering is rare when nothing overlaps). Removed from the
    canvas menu: **Zoom to 100%** (Shift+0 still works and is in the shortcuts sheet).

**P1 and P2 moved to the backlog**

- P1 Opening the inspector on selection narrows the canvas without keeping the selection's
  neighbourhood in view; pan so the selected element and its edges stay visible.
- P1 "Your diagram" is one slot: Open and Import replace it without the Undo that New diagram has.
  Consider a small local library ("Your diagrams") listed in the picker and on the start card.
- P1 The picker's "Your diagram" label doesn't follow title edits until the slot is re-read.
- P1 While a simulation is open in the editor panel, the live bar's picker still says "Free play".
- P2 The React Flow attribution sits under the live bar and the first-run hint (bottom centre).
- P2 The narration card in presentation covers neighbouring nodes; place it in free space when
  there is some.
- P2 "Story & chaos" in the simulation editor is playful; "Timeline" says what it is.
- P2 Start-card examples could show a tiny rendered thumbnail instead of three stencil tiles.
- P2 "Continuous traffic" uses a different icon in the live ⋯ menu and in the right-click menu.

### What changed, in numbers

- **Removed or merged:** live bar ×; canvas right-click Save… and Import ▸; Zoom to 100% from
  the canvas menu; node Copy id, Bring to front and Send to back; the live "Simulation" submenu level;
  8 editing items from live node menus and 6 from the live canvas menu; native title tooltips; the
  Live toggle, minimap and "0 nodes, 0 edges" on a blank canvas; the always-open Diagram inspector
  below 1680px.
- **Renamed:** the terminology table above.
- **Moved:** Save as… and Embed code… out of "More formats" to the File menu top level; Diagram
  properties to the canvas right-click.
- **Added:** the start card (only on an empty diagram), File > New diagram, the one-time hint,
  the node tooltip (replaces a native one), two inspector disclosure headers, and the live keys in
  the shortcuts sheet.

Net: fewer controls on every always-visible surface; the additions appear only on an empty diagram,
once, or on hover.

### Round 1 follow-up

| Round 1 item                     | Status                                                                     |
| -------------------------------- | -------------------------------------------------------------------------- |
| P0 Top bar overflow below 1100px | Resolved earlier (View menu, icon-only labels); verified at 1024.          |
| P0 Diagrams fit too small        | Resolved: panels fold below 1440 (palette) and 1680 (inspector, idle).     |
| P0 Toasts for actions            | Resolved earlier (`notify`), now also used for New diagram with Undo.      |
| P1 Real "New diagram"            | Resolved: File > New diagram and the start card, no reload.                |
| P1 Prefix labels on selects      | Resolved earlier by the View menu.                                         |
| P1 Minimap size                  | Resolved earlier (168×112, hidden below 1100); now also hidden when blank. |
| P1 Inspector polish              | Resolved this round.                                                       |
| P1 One label style               | Resolved this round (sentence case).                                       |
| P2 Native title tooltips         | Resolved this round.                                                       |
| P2 Empty-canvas copy             | Resolved this round.                                                       |

## Round 1 (Phase 3)

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
