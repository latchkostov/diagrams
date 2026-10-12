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
   already has an always-visible control and a shortcut (Fit view, Undo, Redo, Keyboard shortcuts) stays
   out of menus; the palette still finds it (`paletteOnly` in the action registry).
6. **No dead ends, no surprises.** Everything is undoable; destructive actions say so; empty states
   explain what to do next; errors say how to fix them.
7. **Consistent affordances.** Cursor, hover, focus and pressed states match behaviour everywhere
   (pointer = click, grab = drag, text = editable). Same action, same name, same shortcut in every place.
8. **App, not page.** No browser context menu, no stray text selection, no layout jumps. Keyboard first-class.
9. **Teach in place.** Hints, shortcut labels and placeholders over docs. Discoverable from the right-click.
10. **Nothing overlaps by default.** Labels never cover nodes, parallel edges stay distinguishable,
    edges route around nodes, and floating panels never hide content after fit-view. Anything added
    without a spot (a click in the rail, the palette) goes to the free place nearest the view's centre,
    clear of nodes, edges and the last thing added. A traced message's labels never cover a node, its
    badges or each other (they step out with a leader line, or wait for room). An automated overlap audit
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

- **Relationship** is what an edge means: a **flow** or a **dependency**. One word everywhere: the edge
  right-click's **Relationship ▸**, the inspector's Relationship select, and Ctrl+K ("Relationship › Secret").
  - A **Flow** carries messages in Live: a **Message** (async, dashed) or a **Request** (sync, solid). The words
    "async" and "sync" stay in hints only.
  - A **Dependency** never carries messages: drawn thin and dotted with an open arrowhead, a glyph and a muted
    tint (never colour alone). Six, fixed: **Config**, **Secret**, **Identity**, **Telemetry**, **Deploys** and
    **Depends on**. The arrow points from the thing that needs it to the dependency (Deploys: from the actor
    to what it changes). No default text on the canvas; the glyph says it, and the implicit words ("reads
    secrets") are for the tooltip, screen readers and exports.
  - Drawing an edge into a typed stencil (Key Vault, App Configuration, an identity, an observability
    backend) picks the dependency; the first time, a toast offers **Make it a flow**.
  - **Settings** are the keys a config edge reads, a lock on the secret ones: "4 settings · 2 secret" on the
    canvas, the list on hover or focus. A config store's secret edge says "2 references".
  - **Dependencies** (Show ▸ Dependencies, View menu) shows or hides them all, one remembered setting.
    Hidden, a node keeps small glyph **pips** with the list on hover.
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
- **Storage**: where files live. **This device** (never "local", "computer" or "disk"; mid-sentence "this
  device"), **Google Drive**, **OneDrive** and **Dropbox** (never "Drive", "OneDrive Personal" or "Dropbox
  account"). The verbs are **Open…** (this device, Ctrl+O), **Open from ▸**, **Save** (Ctrl+S: back to where the
  diagram came from; with no file yet it reads **Save to this device…**), and **Save to ▸** (always a new
  file; This device… is Save as, Ctrl+Shift+S). Each submenu lists This device first, then the configured
  providers; an unconfigured provider never appears. The status beside the picker says **Saved to
  OneDrive · 2 min ago** or **Opened from Dropbox**. Signing out is **Sign out of OneDrive**. The folder a
  provider sees is **Apps › Diagrams**.
- **Trace a message** follows one message (and its fan-out copies) hop by hop: click a moving message,
  right-click a node for **Trace next message from here**, or use **Trace a message ▸** (Next message,
  Slowest so far, One that dead-lettered) on the live right-click, in ⋯ and in Ctrl+K. The **trace
  card** lists its hops; **Sequence diagram** turns the journey into one (Copy as Mermaid, SVG, PNG).
  The edge's **Highlight this path** is a different idea (a static path, no message), so it never
  says "trace".
- The **AI panel** is the docked panel at the right edge, in every diagram (editor and live view; never
  presenting or in embeds), where you see and control what AI did. AI here means **agents**: the
  browser's AI assistant, or any agent that can use the page, changes the diagram through the page's
  tools (WebMCP); the app never asks for an API key. It starts folded to its slim **rail** at the right
  edge (40 px) and after that stays as the person left it. The rail, Ctrl+I, and **AI panel** on the
  canvas right-click and in Ctrl+K show it; the top bar has no AI button. An agent acting never opens the
  panel or moves the canvas: while folded, the rail's spark counts the agent changes not yet seen in this
  diagram ("AI panel, 2 new changes"), and opening the panel clears it.
- The panel has no request box: you **ask an agent**, never the panel. Idle, it answers "how do I use this?"
  under **Ways to use AI here**, at most three short items, each with one action: **Your browser's AI
  assistant** (only with WebMCP; **Copy example request** copies a request naming a real node), **Your coding
  agent** (**Install the skill**, the site's `/skill/` page) and **Any chatbot** (**Open Advanced**). With
  WebMCP, **What agents can do here** (collapsed) lists the published tools, one line each. Once there are
  turns, the conversation takes over and all this folds to one link, **How to use AI here**.
- The **status line** at the panel's foot is honest: WebMCP only means the page publishes its tools, so it
  says "This page publishes 6 tools for AI agents in this browser (WebMCP)" and, muted, that the browser's
  assistant must support WebMCP and that requests are typed there, not here. Without WebMCP it points agents
  that drive pages to llms.txt. It never claims an assistant will use the tools.
- Each change is a **turn** in the diagram's **conversation**: the agent's own note (the tools' optional
  `summary`), what changed ("+3 nodes, +2 connections"; while the panel is folded, a toast carries **Undo**, and it goes
  when the panel opens) and a highlight on hover. A turn offers **Undo this change** only while its own step is the next undo; any turn offers
  **Revert to here** (itself one undo step). **Clear conversation** is undoable. The conversation stays in
  this browser and never goes into files, exports or share links.
- **Copy for AI** (node, edge or selection right-click, editing and live) puts the elements' ids and labels on the clipboard,
  to paste into the request you give your agent ("change these").
- **Advanced** (the panel's foot, closed by default and remembered) is the manual flow for people without
  an agent: **Copy prompt** for any chatbot, paste the reply, **Apply**; in live view it **simulates a
  scenario** (the reply becomes a saved simulation that plays at once) and **Explain** only copies a
  question. A failed reply shows **Nothing was applied**, the elements it could mean (pick one to apply)
  and **Copy fix-up prompt**. A stencil the app wasn't sure of says **not sure** (or **a guess**) with its
  alternatives as one-click chips.
- **Build with AI** (Ctrl+K only) starts a new diagram from a description: a blank diagram with Advanced
  open. Never "Build with AI" for changing a diagram.
- A **local-only** diagram never reaches any AI: the page's tools are off, Copy for AI copies nothing, and
  the panel says AI is off for this diagram.
- **Dictate** is the mic in Advanced's describe box (Ctrl+Shift+M): **Listening…** while on, interim words shown
  lighter; **Stop dictating** to end. It's hidden where the browser has no speech recognition.
- **Slow motion** (noun and mode) is a paced _replay_ of a trace: one message's recorded journey, node
  by node, while live waits frozen ("Slow motion · live paused" in the bar). Menus say **Watch … in slow
  motion**: the node right-click's **Watch one message in slow motion from here**, and **Next message, in
  slow motion** first in Trace a message ▸ (right-click, ⋯, Ctrl+K). The trace card's **Slow motion**
  (and the palette's "Slow motion: replay this trace") replays the message traced now. It adds no bar
  control: play, Restart (Replay), speed (pace) and the timeline drive the replay while it's on, ← →
  step hop by hop, and Esc goes back to live where it left off. Record video… offers **Record this slow
  motion**. Below 1× live draws a calm sample of whole journeys; the counts never change.
- Side panels make room rather than cover: below 1680 px, live view and an open AI panel fold the stencils to
  their rail until they are opened by hand. Toasts centre on the canvas pane and stack above its bars.
- Esc backs out one level: menu, dialog, selection, slow motion, trace, highlighted path, presentation, then live view.

## Process

Every feature batch ends with a **UX review gate** before new work starts: a designer agent walks the
whole app against these rules, flags clutter and inconsistency, and simplifies (removes, merges, moves to
context) before adding. Findings go in `docs/DESIGN-REVIEW.md`.
