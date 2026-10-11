# UX principles

Simple enough that a first-time visitor makes a beautiful diagram in a minute; deep enough that a
power user can model a real system and replay it in a meeting. When the two conflict, the simple
path wins by default and the power path stays one step away.

## Rules

1. **Beautiful by default.** Every default (layout, colours, edge style, simulation speed) should look
   and behave well without touching a setting. A setting that most people need to change is a bad default.
2. **Progressive disclosure.** Show the 20% of controls used 80% of the time. Everything else lives in
   context menus, the inspector, or an "Advanced" section, never in the top bar.
3. **Context over chrome.** Prefer acting on the thing itself (right-click, double-click, drag, inspector
   for the selection) over global toolbars and modes. Actions appear where and when they apply.
4. **One primary action per surface.** Each panel, dialog and bar has one obvious main action; the rest
   are visually secondary.
5. **Budget the chrome.** Top bar: at most ~7 controls. Floating bars: one row. Menus: ≤ 12 items per
   level, grouped with separators. Adding a control means removing or folding another. An action that
   already has an always-visible control and a shortcut (Fit view) stays out of menus; the palette
   still finds it (`paletteOnly` in the action registry).
6. **No dead ends, no surprises.** Everything is undoable; destructive actions say so; empty states
   explain what to do next; errors say how to fix them.
7. **Consistent affordances.** Cursor, hover, focus and pressed states match behaviour everywhere
   (pointer = click, grab = drag, text = editable). Same action, same name, same shortcut in every place.
8. **App, not page.** No browser context menu, no stray text selection, no layout jumps. Keyboard first-class.
9. **Teach in place.** Hints, shortcut labels and placeholders over docs. Discoverable from the right-click.
10. **Nothing overlaps by default.** Labels never cover nodes, parallel edges stay distinguishable,
    edges route around nodes, and floating panels never hide content after fit-view. Anything added
    without a spot (a click in the rail, the palette) goes to the free place nearest the view's centre,
    clear of nodes, edges and the last thing added. An automated overlap audit
    (`tests/e2e/layout.spec.ts`) guards every example.
11. **Presentation is a first-class mode.** Anything shown in a meeting reads at a distance and hides editing
    chrome (selection handles, placeholders). The same goes for exported images and recorded videos:
    a recording is always in presentation view, and annotations are at full strength in all three.

## Vocabulary

One word per idea, everywhere (menus, inspector, File menu, live bar, docs):

- **Live** is the mode where messages flow (toggle, L). A **simulation** is a saved, scripted run you
  replay in it. "Free play" is live without one.
- **Boundary** (never "group") for the box around nodes: Add boundary, Remove boundary, Colour.
- **Annotations** document a diagram and never take part in the simulation. Four kinds, one word each:
  - **Text**: plain words on the canvas (titles, captions), no chrome. `T` adds text at the pointer.
  - **Note**: a tinted sticky note.
  - **Zone**: a labelled, dashed region drawn behind nodes. **Zone vs boundary:** a boundary groups nodes
    (they belong to it and move with it, and it can be fitted to them); a zone is a visual region only.
    Nodes don't belong to a zone, and moving a zone moves nothing else. They look different too: a
    boundary has a solid edge and a label chip with a swatch; a zone has a dashed edge and plain
    sentence-case words. With things selected, Annotate ▸ Zone draws the zone around them.
  - **Shape**: a plain outline (rectangle, rounded rectangle, ellipse, diamond, cylinder) for when no stencil
    fits. The only annotation an edge may end on, for documentation; no traffic flows to or from it.

  One verb, **Annotate**, everywhere they're added: **Annotate ▸** on the canvas right-click (next to
  "Add node here"), the stencil rail's **Annotate** row (Text, Note, Zone, Shape, pinned under the
  list), the palette ("Annotate › Note"), and `T`. A Shape starts as a rectangle; the inspector, the
  right-click's Shape ▸ and search ("ellipse") pick the outline. Their menu says **Edit text** (a zone:
  **Rename**), **Colour** and **Shape**.

- **Subtitle** for a node's second line. **Properties** opens the inspector for the thing.
- **Your diagrams** is the user's own library in this browser (File > Your diagrams…, the picker's
  first group, the start card's first list). Open, Import, Paste and **Save a copy** each add a diagram
  to it; nothing ever replaces another. A blank **New diagram** joins it on its first edit. The
  built-in ones are **Examples**; the **Stencils** tab is the catalogue.
- In Your diagrams: **Rename**, **Duplicate** and **Delete** (undoable), the same names everywhere.
- A simulation's scripted events are its **Timeline** (not "Story & chaos").
- **Inputs** (the live bar button) opens the **Inputs & capacity** panel: how much traffic enters
  (**entry points**, in msg/s) and how big things are (replicas, partitions). **Show capacity** (C,
  View menu, Show ▸ Capacity) is the heat map over the diagram, one remembered setting; the panel
  shows it while open without changing that setting. The callout's verb is **Apply fix**.
- The Live toggle's words are **Go live** and **Back to editing**, in the palette too.
- **Record video…** (live ⋯ menu and the live right-click, same icon in both): **Start recording**, a
  3-2-1 countdown, a pill with the time and **Stop** (or Esc), then **Your recording** with **Download**
  and **Discard** (undoable). With a simulation picked, the one option is to play it from the start
  and stop when it ends.
- Same action, same name in the File menu and the right-click (e.g. Export PNG, Copy share link).
- **Trace a message** follows one message (and its fan-out copies) hop by hop: click a moving message,
  right-click a node for **Trace next message from here**, or use **Trace a message ▸** (Next message,
  Slowest so far, One that dead-lettered) on the live right-click, in ⋯ and in Ctrl+K. The **trace
  card** lists its hops; **Sequence diagram** turns the journey into one (Copy as Mermaid, SVG, PNG).
  The edge's **Highlight this path** is a different idea (a static path, no message), so it never
  says "trace".
- Esc backs out one level: menu, dialog, selection, trace, highlighted path, presentation, then live view.

## Process

Every feature batch ends with a **UX review gate** before new work starts: a designer agent walks the
whole app against these rules, flags clutter and inconsistency, and simplifies (removes, merges, moves to
context) before adding. Findings go in `docs/DESIGN-REVIEW.md`.
