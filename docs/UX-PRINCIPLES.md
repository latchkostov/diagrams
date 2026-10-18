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
    clear of nodes, edges and the last thing added; with one node selected, one gap beside it, connected. A traced message's labels never cover a node, its
    badges or each other (they step out with a leader line, or wait for room). An automated overlap audit
    (`tests/e2e/layout.spec.ts`) guards every example.
11. **Presentation is a first-class mode.** Anything shown in a meeting reads at a distance and hides editing
    chrome (selection handles, placeholders). The same goes for exported images and recorded videos:
    a recording is always in presentation view, and annotations are at full strength in all three.

## Vocabulary

One word per idea, everywhere (menus, inspector, File menu, live bar, docs):

- The product is **Live Diagrams**, two words, wherever it names the app: the top bar, page titles, messages,
  policies and the providers' consent screens, which must match the home page exactly. Never "LiveDiagrams" or
  plain "Diagrams" for the app; "diagrams" stays the common noun ("Your diagrams"). A company's own copy may name
  itself (`VITE_BRAND_NAME`, docs/SELF-HOSTING.md): the top bar and the page title then say that name.
- **Live** is the mode where messages flow (toggle, L). A **simulation** is a saved, scripted run you
  replay in it. "Free play" is live without one.
- **Boundary** (never "group") for the box around nodes: Add boundary, Remove boundary, Colour.
  - **Membership**: a node belongs to the boundary around its centre (the inner one, when one sits in another).
    While you drag, the boundary that will hold it on drop shows its outline in its tone, and one it would leave
    shows dashed. Leaving is never silent: a toast says so, with Undo ("Payments service left AKS").
  - A member dropped so it pokes out **grows** its boundary to hold it, with the usual padding, in the drop's
    undo step; so does a node added inside one (quick-add, Alt+arrow, the rail, a paste). It never grows onto
    another boundary or a node that isn't its own: then it shows dashed and stays as it is. Boundaries never
    shrink by themselves; **Fit to contents** (right-click and the inspector) does.
  - **Resizing** a boundary takes in the nodes now inside it and lets go of those outside, and says so ("Added 2
    nodes to Payments", with Undo).
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
  - **Changing a node's stencil** does the same for its edges, in the change's undo step: a flow into what becomes App
    Configuration turns Config, and what was inferred turns back into a flow when it stops being one. A toast says
    what changed ("2 connections are now Config: no messages flow over them") with **Undo**. A relationship someone
    chose (Relationship ▸, the inspector, **Make it a flow**) never changes by itself.
  - A new flow into a database, a gateway, an outside or model API, or out of a client or a gateway, starts as a
    **Request**; into or out of a queue, topic or stream it's a **Message**, as it is elsewhere
    (`src/stencils/edgeKind.ts`; an agent's `connect` without a kind gets the same). The first time, a toast says
    "Request: the caller waits for a reply" and offers **Make it a message**. A relationship inferred above wins (an
    edge into Key Vault is a Secret, not a Request), and edges already in a file keep their kind.
  - **Settings** are the keys a config edge reads, a lock on the secret ones: "4 settings · 2 secret" on the
    canvas, the list on hover or focus. A config store's secret edge says "2 references".
  - **Dependencies** (Show ▸ Dependencies, View menu) shows or hides them all, one remembered setting.
    Hidden, a node keeps small glyph **pips** with the list on hover.
- **Subtitle** for a node's second line. **Properties** opens the inspector for the thing.
- **Quick-add** is the stencil search that opens on the canvas: double-click empty canvas, drop a connection
  there, press **Alt+arrow** or click the **"+"** on a selected node. Recently used stencils come first, and
  the search ranks as the stencil rail's does ("pg" finds PostgreSQL). From a double-click the pick lands on
  the spot, unconnected; from a dropped connection on the drop point; from Alt+arrow or the "+", one gap beside
  the node, under the faint outline shown while quick-add is open. Every pick arrives selected, with its **Label**
  focused in the inspector (the name selected, so typing replaces it, never reaching the canvas's one-key
  shortcuts); one made connected also shows a **Connection** field, one Tab after the Subtitle, while it's being
  named. Menu and rail clicks don't open the name. A **new node is one undo step** with its connection and the names
  typed for it (label, subtitle, connection), however long the naming takes: a creation transaction opens when the
  node is made and closes with Enter or Esc, or when focus leaves its name fields. The same holds for a node added
  from the rail or Ctrl+K and named with Enter straight after. An edit in between (a nudge, another node) closes it,
  and the name is then a step of its own.
- **The next node**: a single selected node shows one **"+"** on its downstream side (right, or below in a
  top-to-bottom diagram; another side when a neighbour or a label is there). Never a "+" on every node, never
  on hover. **Alt+→ / Alt+↓** add downstream (the new node is fed by the selected one), **Alt+← / Alt+↑**
  upstream (it feeds it). **Alt+Shift+arrow** skips quick-add and puts a copy of the node there, connected the
  same way. The new node lands clear of everything, in view, its name ready to type; the gap along the flow
  leaves room for the connection's label. A rail click or Ctrl+K "Add …" with one node selected adds after it
  the same way (the rail's footer says "A click adds after Order service"), without opening the name.
- **Reconnect**: a selected edge shows a round end at each side; drag one onto another node to move that end
  there. The edge keeps its label, relationship and settings; dropped anywhere else (or Esc) it snaps back. From
  the keyboard: the edge's right-click and Ctrl+K, **Reconnect ▸ From / To**, with a node search.
- **Insert**: hold a node with no edges of its own (or a stencil from the rail) over an edge for a moment, and
  the edge lights up; drop it there and it goes in between (A→B becomes A→N→B, both keeping the edge's
  meaning, the label on the first). Passing over an edge, or dropping with Ctrl/⌘ held, never splits it. A
  stencil dropped on a node goes after it, connected. From the keyboard: the edge's right-click and Ctrl+K,
  **Insert node ▸** (a stencil search); the new node's name opens. A new node and its name are one undo step.
- The **selection box** is a drag on empty canvas while editing. It picks what it touches (hold Ctrl/⌘:
  only what's wholly inside), boundaries and zones only when wholly inside, and the edges whose both ends it
  picked. It replaces the selection; with **Shift** held as it starts, it adds to it. **Shift+click** and
  Ctrl/⌘+click add to or take out of the selection. The inspector waits for the
  pointer-up, so nothing moves under a drag.
- **Bulk edit**: with several things selected the inspector shows **Arrange** first (Align; Distribute and **Tidy
  up** at three or more), then a small section per kind present, headed by its count ("3 nodes", "2 edges"):
  nodes' **Stencil**, **Boundary** and the **Simulation** settings their roles share; edges' **Relationship** and
  **Label**; annotations' and boundaries' **Colour**. Where the values differ the field says **Mixed** and is
  empty; setting it sets all of them, as one undo step. A mixed selection fits one screen at 1280×800.
- **Select similar** (a node's or an edge's right-click, Ctrl+K): every node of the same stencil, or every edge of
  the same relationship (Message, Request, or that one dependency). Then bulk edit them.
- **Tidy up** (the selection's right-click, the inspector's Arrange, Ctrl+K; three or more nodes): the layered
  layout on just those nodes and the edges between them, inside their box where it fits, its top-left kept.
  Nothing else moves, and if the result would cover anything the tidied nodes move together to the nearest free
  place. Members stay in their boundaries, which grow to hold them. When no place within reach is clear (or
  a boundary can't grow to hold its members), nothing moves and a toast says "Couldn't find room. Nothing
  moved." **Align** and **Distribute** never stack
  things either: what would land on another steps along the line. **Auto-layout** (the canvas right-click) is
  the whole diagram.
- **Undo and the selection**: Undo puts the document back, then selects what the undone step changed, as it
  was before; Redo selects what it changed, as it is after. If everything it changed was part of the selection
  the step was made with, that whole selection comes back (an align or a Tidy up leaves a node where it was).
  Undoing an add leaves nothing of it to select: the current selection stays where it still exists, and if
  none does, the selection the add was made from comes back. Undoing a delete selects what came back; undoing
  Bring to front or Send to back, what moved in the order. Knock-on changes don't count: a boundary that grew
  to hold its members, members carried by a boundary that moved without changing size. The inspector follows,
  so a bulk edit undone keeps its panel open with the old values, to tweak and retry. Undone from the canvas
  (Ctrl/⌘+Z with focus on a node, an edge or the canvas), focus moves to the first selected node in Tab's
  order, which comes into view and is announced ("Undone. Orders API selected."); from the toolbar or a panel,
  focus stays where it is. Selecting is never an undo step of its own.
- **Moving between nodes** from the keyboard: the canvas is one Tab stop. Inside it **Tab** and **Shift+Tab** step
  through nodes in reading order (rows from the top, each left to right; in a top-to-bottom diagram, columns),
  meeting each boundary just before its first member; past the last one Tab leaves the canvas. **Ctrl+Alt+arrows**
  (⌃⌥ on a Mac) go to the nearest node that way, and **Ctrl+Alt+]** and **[** to the node's outgoing and incoming
  edges (again: the next one). Selection and focus move together, the view follows, and a screen reader hears
  the node, its boundary, its place in the order and its edges ("Payments service, Go Service, processor, in AKS.
  6 of 16. 2 out, 1 in."). Controls on a node or an edge (a node's dependency pips, an edge's settings) aren't Tab
  stops of their own: their list opens when the node or edge is reached from the keyboard, and the announcement
  reads it. A diagram of boundaries only starts at its first boundary. The arrow keys still nudge and Alt+arrow
  still adds the next node.
- **Pan** and **zoom**: the wheel and a two-finger swipe pan (Shift+wheel sideways); Ctrl/⌘+wheel and a pinch
  zoom at the pointer; Space+drag and the middle button pan from anywhere, even a node. Live view,
  presentation and embeds keep drag-to-pan, and an embed lets the wheel scroll its page. The keys: **Fit
  view** (Shift+1), **Zoom to selection** (Shift+2, at most 125%, or the hovered node with nothing selected)
  and **Zoom to 100%** (Shift+0).
- **Duplicate** (Ctrl+D) puts the copy one gap beside the original in the flow direction, clear of
  everything; again on the copy repeats the step, or the gap you chose by moving it. **Paste** (Ctrl+V)
  centres on the pointer over the canvas (else the view's centre); **Paste here** (right-click) puts it at the
  click. **Alt+drag** drags a copy and leaves the original. A copy never lands on the original or on any
  other node: it moves to the nearest free place.
- **Snapping** (Show ▸ Snapping; on by default, one remembered setting; never "Snap to grid") is the grid and
  the guides together. While you drag a node or a selection it lines up with nearby nodes' edges and centres
  (one thin accent line per axis) and with equal gaps in its row or column (the two gaps, each marked "="),
  else with the 10 px grid. Guides engage once the pointer slows down, so a fast drag isn't sticky. Hold
  Ctrl/⌘ to drag freely. Guides show only during a drag: never in presentation, live view, exports or
  recordings. The arrow keys nudge onto the grid: to the next 10 px line, Shift 50 px (Snapping off: 1 px and
  10 px). The dots are every 10 px from 100% zoom and every 20 px below.
- **Renaming happens in the inspector** (the owner's decision, 2026-10-13: "Double-clicking a service should open up
  the property sheet... The name change should be part of the properties sheet."). A **double-click** on a node, a
  boundary or a connection, **F2**, **Enter** on a single selected one, and its menu's **Rename** or **Edit label**
  select it, open the inspector (even when it was hidden) and focus its **Label** with all of it selected, so typing
  replaces it. The Subtitle is the next field (Tab). Nothing opens on the canvas for them. An annotation is the
  exception: a text's, a note's or a zone's words _are_ the thing, so a double-click (or F2, Enter, Edit text) edits
  them in place, all selected. Live opens the same inspector for nodes, boundaries and connections; annotations
  stay inert there. Enter first continues a waiting narration; F2 still opens the name while it waits.
  Presenting, read-only views, embeds and the HTML viewer open no editor at all.
- **Editing text** follows one set of keys in the inspector's name fields and an annotation's editor. Names are
  saved as they're typed, so **Enter** and **Esc** are both "done": focus goes back to the thing on the canvas, so
  the next key acts on it (an annotation: Enter adds a line, Ctrl/⌘+Enter or Esc saves; Tab saves too). A click
  away is done as well. Ctrl/⌘+Z right after takes the edit back; a rename, however many keys, is one undo step.
  Nothing cancels. An annotation's editor never reads smaller than its own size, at any zoom.
- **Selecting text with the mouse** works as it does in every text field, on macOS and Windows, in Chrome, Firefox
  and Safari: in an input, a textarea and contenteditable alike, a **double-click selects a word** and a
  **triple-click the line** (all of a one-line field; a textarea's paragraph). Windows takes the space after a word
  with it. A click places the caret, Shift+click and a drag extend the selection. Starting a rename **selects all of
  the name** (the extension-less name in Finder and Explorer), as Figma, Miro, Lucidchart, draw.io, Excalidraw, the
  macOS Finder and Windows Explorer do, so typing replaces it. Once in the field, double- and triple-click are the
  platform's own; nothing reopens or reselects it. The selection is always visible: `--selection-bg` and
  `--selection-text` (`tokens.css`) in every field, in both themes, the text at AAA on the highlight and the
  highlight clearly apart from the field. Nothing on the drawing itself is selectable (App, not page).
  Keys typed before Ctrl+K's search or a new node's name can take them are kept for it ("Ctrl+K kafka").
  The shortcuts sheet (`?`) lists every key here, the File menu's (Ctrl+O, Ctrl+S, Ctrl+Shift+S) and slow motion's
  (← →) included.
- While **connecting**: a crosshair throughout, the node a drop connects to lit up (anywhere on it), a "+"
  at the line's end over empty canvas, and `not-allowed` over a text, note or zone. Handles are hittable
  from at least 20 px on screen at any zoom, just outside the card.
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
- A topic or stream with no consumer **keeps** what's published: "Nobody reads this yet · 297 kept", never "lag"
  (lag is per consumer group) or "No capacity". A queue's messages are **queued** and **waiting**. The callout says
  **Nobody reads Kafka Topic**, and its one action is **Add a consumer**.
- The Live toggle's words are **Go live** and **Back to editing**, in the palette too.
- **Record video…** (live ⋯ menu and the live right-click, same icon in both): **Start recording**, a
  3-2-1 countdown, a pill with the time and **Stop** (or Esc), then **Your recording** with **Download**
  and **Discard** (undoable). With a simulation picked, the one option is to play it from the start
  and stop when it ends.
- Same action, same name in the File menu and the right-click (e.g. Export PNG, Share…).
- **Share…** (File menu, the right-click's Export ▸, Ctrl+K, which also finds it as "link") is the one way out that
  lists every way out: a dialog, **Share**, whose rows each say who can open what they make, safest first. Never
  "Publish", "Send" or "Copy link" for it. Its rows, in order:
  1. **Interactive HTML…** (its password is in its own dialog), 2. **Diagram file** (saves at once), 3. **Embed in
     your app…** (Your app supplies it (private)), 4. **Link with password…**, then, below a rule and folded behind
     **Public link or embed · anyone with the link can open it**: **Share link…** and **Embed on a public page…**,
     each saying **Public:** first. The public ones are never the default focus or what Enter first does: the
     keyboard lands on Interactive HTML, the fold is one Tab stop that opens with Enter (and stays on it), and it
     starts folded every time. The arrow keys, Home and End walk the rows.
  - Each row hands over to the dialog that does it (Interactive HTML, Embed code, Link with password, Share
    link), which replaces Share: Esc closes that dialog, and the keyboard goes back to where Share… was opened.
  - A **Private** diagram lists only rows 1 to 3, and one line: **Links and public embeds are off for a private
    diagram. Make it not private…** (the Private diagram dialog, Keep private its default). A copy built without
    share links (docs/SELF-HOSTING.md) has rows 1 to 3 and nothing else; the gates in `src/lib/localOnly.ts` decide.
  - **Edit together…** (rooms; development and e2e builds until they ship) follows Link with password behind its own
    rule: anyone with its link can _edit_ while someone is in the room, so it is never the first row or what Enter
    first does. Ctrl+K finds it as "collaborate", "room" and "edit together". Never "live room", "session" or
    "collaboration mode" ("Live" is the simulation view). A **Private** diagram has no such row; its line reads
    **Links, rooms and public embeds are off for a private diagram.**, and Ctrl+K's Edit together… opens the same
    explanation, never a disabled row.
  - **Edit together** asks first, every time: starting or joining a room names who sees your IP address (everyone in
    the room, two public matchmaking services, never the diagram or the link) and the services by host, and asks for
    your name in the room (names aren't verified). Nothing is contacted before Start room or Join; **Don't join** is
    the join dialog's default. While a room is open, the room chip takes the save-status slot ("3 here ▾": who is here,
    **Copy room link**, **Leave room**); there is **Leave room** only (no "End for everyone"), it needs no
    confirmation, and your copy stays in Your diagrams. Waiting for others is never an error; a failure always
    offers Retry and a file copy, and says why in plain words.
  - **Link with password…** comes before the plain link wherever links are listed. Its password is at least 8
    characters with a strength hint, and the dialog always says: send the password separately; anyone with the link
    and the password can open it.
- **Interactive HTML…** (File ▸ Export as ▸, the right-click's Export ▸, Ctrl+K) is the one self-contained file for
  sharing a diagram where a team already controls access; never "standalone", "offline page" or "web export". Its
  dialog always says **Anyone who has this file can open it.**, its one action is **Download HTML**, and the title,
  **Banner**, theme and simulations sit behind Options. A Private diagram can export it, as it can Save to this
  device. In the file: the banner on top, and a footer that says "Exported from Live Diagrams on <date>. Read-only."
  - **Require a password** (a checkbox under that line, off by default) encrypts the file with the same field as Copy
    link with password… (at least 8 characters, the strength hint, Show; no confirm field). The line then says **Only
    people with the password can open it.** Send the password separately, and one line under the field says what's
    encrypted and that the password can't be recovered. The file is titled **Diagram (password protected)** and
    named for it with a short random suffix ("Diagram (password protected) k7m2q.html"); opened, it shows **This diagram is password-protected**, one field and **Open** (Enter), and a wrong
    password says **That password doesn't open this file. Check it and try again.**
- **Who can open it.** Every way a diagram leaves the app says who can open what it makes, in these words, where
  you choose it (the File menu's line, the dialog) and in its toast:
  - Interactive HTML…: **Anyone who has this file can open it.** With Require a password: **Only people with the
    password can open it.**
  - Diagram file: **Anyone who has this file can open and edit it.**
  - Embed in your app… (Your app supplies it (private)): **The diagram never leaves your app.**
  - Link with password…: **Only people with the password can open it** (the dialog: anyone with the link and the
    password).
  - Share link…: **Public: anyone with the link can open it.** (its toast: Share link copied. Anyone with the link can
    open the diagram.)
  - Embed on a public page… (in the link, or an example by name): **Public: anyone who can see the page can open
    it.** (the dialog: Anyone who can see the page can open this diagram.)

  For a work diagram the safe choices are, in order: Interactive HTML (read-only, offline; with a password when it
  may be forwarded beyond the team), the diagram file, an embed your app supplies, and a link with a password: Share's
  order. Both embed rows open the dialog titled **Embed code**, each with only its own kind.

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
  says "This page publishes 7 tools for AI agents in this browser (WebMCP)" and, muted, that the browser's
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
- The **on-device model** is Chrome's built-in model (the Prompt API): no key, nothing leaves the device.
  Where it can run, the panel's only request box sits at its foot (on by default since round 3, at the
  owner's direction; **Advanced ▸ Try the on-device model** turns it off, remembered): "Describe a change…", the mic, **Send** (Enter), labelled "Runs on this
  device with Chrome's built-in model". A one-time **Download the on-device model** shows progress first
  where needed. Its changes are turns like an agent's ("On this device"); a reply that doesn't fit after one
  retry says **Couldn't apply that. Try rephrasing.** and applies nothing. **Stop** (or Esc) cancels, and
  so do going live or switching diagrams. Nothing lands if the diagram changed meanwhile. Its mic is Advanced's,
  with the same feedback, and until speech is confirmed on this device the box says dictation may use the
  browser's speech service. It edits only: in live view the box waits for **Back to editing**. Where the model can't run, nothing shows.
- **Build with AI** (Ctrl+K only) starts a new diagram from a description: a blank diagram with Advanced
  open. Never "Build with AI" for changing a diagram.
- **Private** (never "local-only", "secret" or "confidential" in the UI) keeps a diagram on this device: no share
  links or link embeds (only **Your app supplies it (private)**), no cloud saves, no AI. The switch is **File ▸
  Privacy ▸ Private diagram** (and Ctrl+K, "Make this diagram private"); a **Private** lock badge sits beside the
  title, and its click opens the **Private diagram** dialog, the one confirmation for **Make not private** (**Keep private** is the default). Share…
  lists only the files and the embed your app supplies, with one line saying why the links are off and **Make it not
  private…** (the same dialog); a link dialog open when it turns private (here or in another tab) closes, saying "Private diagrams can't be
  shared as links. Export Interactive HTML instead." with **Interactive HTML…** as its action; the panel says
  **AI is off for this private diagram** and offers **Allow the on-device model (stays on this device)**. Copies,
  duplicates, exports (`"private": true`) and pasted nodes stay private. **New diagrams are private** (File ▸
  Privacy ▸) is one remembered setting, off by default, and never turned on by itself (Private turns AI off, and the
  agents-first direction needs AI on): the first Import report of an infrastructure file (Terraform, Kubernetes,
  docker-compose, AsyncAPI) offers it once, as a checkbox under **Make it private**, and never asks again (Clear
  everything forgets that it asked). **Clear everything on this device…** (last in File ▸ Privacy ▸)
  is the one wipe: a confirmation that lists what goes and what stays, with **Cancel** the default. Making a diagram
  Private that has an AI conversation offers **Clear conversation** in its toast (one step, with Undo). The built-in local-only examples (development only) are
  always private, with their own wording.
- **Dictate** is the mic in Advanced's describe box (Ctrl+Shift+M): **Listening…** while on, interim words shown
  lighter; **Stop dictating** to end. While the browser's speech service (not the device) listens, one muted line under
  it says so every time: "What you say may be sent to Google's speech service." (Microsoft's in Edge, Apple's in
  Safari, "your browser's" elsewhere). It's hidden where the browser has no speech recognition.
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
- **Checks** find likely design problems (failed messages that are dropped, a topic nobody reads, requests that go
  round in a circle or chain too deep, a service using another's database, a client going around the gateway, a
  service that can't keep up or that every request goes through on one replica) and offer a **fix** for each. Never
  "lint", "issues" or "errors":
  a **finding** is a **Warning** or a **Suggestion**, and nothing blocks saving, sharing or going live.
  - **The count**: "⚠ 2 warnings" under the diagram's title, muted, only when there's a warning (suggestions alone show
    nothing, and with none there's no "0 issues"). Editing only: no count in live view, presenting, embeds or exports.
  - **Check diagram** (the count, the canvas right-click next to Auto-layout, Ctrl+K, View ▸ Checks) opens the
    **Checks card** under the diagram card: warnings, then suggestions. A row's head selects what the finding names
    and brings it into view (as a new selection is shown); its chips select one thing each; **Why** says why it
    matters. The row's one button is the fix, named for the change ("Add dead-letter queue"), applied as one undo
    step with a toast that says what it added and offers **Undo**. A fix that needs a choice ("Add a consumer…")
    opens quick-add downstream. A fix with other ways to make it shows them as quiet chips under its button ("Go
    through Commerce gateway", or Firewall / WAF · Kong Gateway), each one click and one undo step. **⋯** has **Ignore here…** (an optional reason), **Turn off this check** and **About
    this check**; the foot's "1 ignored · 1 check off" brings them back. Both are kept in the file (`checks`).
  - **Markers** (an amber triangle for a warning, a blue dot for a suggestion) show on the nodes and connections a
    finding names, only while the card is open. A single selected node or connection with findings shows them at the
    top of its inspector, with the fix.
  - Checks run by themselves after edits pause, in idle time and off the main thread, so typing and dragging never
    wait. A diagram over 1,500 nodes is checked when the card opens. Private diagrams are checked too: it all stays
    on this device. Only the agents' `check_diagram` follows the AI rules.
  - **Run simulations** (a quiet link under the card's summary, Ctrl+K and the canvas right-click after Check diagram;
    only while editing a diagram with saved simulations) plays them headless, a minute of each at most, and counts the
    messages they lose: "24 dropped in “Payments service goes down”" under the finding it bears out, and **Messages are
    lost at …** (a Suggestion) where no other check says so. It reports and never fixes: what it raises has no fix
    button and no fix chips (the static checks offer the fixes). From Ctrl+K or the right-click it opens the card
    first. While it plays the line says **Playing 2 of 5: “…”…** and the link is **Stop** (in Ctrl+K and the
    right-click, **Stop simulations**); then **Run again**. It counts losses
    only, never backlog, and what a simulation loses on purpose (a node it takes down or makes fail, what its own
    expectations count on) is one muted **On purpose:** line, never a finding. Counts never raise a warning, never go in
    the file, and hide the moment an edit a simulation would see is made (**The diagram changed since the simulations
    played.**); moving or selecting things doesn't count, and Undo brings them back.
- **Network devices** (routers, switches, firewalls, ADCs) are drawn as device glyphs, the vendor being the stencil's
  name and colour. A device's **Size** is a preset (branch, campus, data centre) named for the model it comes from,
  its boxes are **Units**, and **High availability** says how they work (Standalone, Active-standby pair, Active-active
  cluster). A connection leaving a firewall is a **Firewall rule**, **Allow** or **Deny**; what a deny rule stops is
  **blocked**, never "dropped", "lost" or "failed", and it's shown apart from failures (a neutral badge with a "no
  entry" glyph, never the red count).
- Esc backs out one level: full screen (the browser takes that Esc itself), menu, the Embed dialog's preview (back to
  the dialog), dialog (a dialog opened from Share… replaces it, so Esc closes it, back to where Share… was opened),
  selection, simulations playing (Run simulations), the Checks card, slow motion, trace, highlighted path,
  presentation, then live view.
  In a text field on the canvas it saves and leaves the field (Editing text, above). Esc never selects, and clearing a
  selection leaves keyboard focus where it was (on the node), never on the page.
- **Undo toasts** ("Payments service left AKS · Undo", an agent's change, an applied fix) offer to reverse one change.
  The moment anything else undoes or redoes (Ctrl+Z, the canvas's Undo), the toast goes: its button would reverse
  a different change.
- **Present** is the top bar's button and Ctrl+K's "Present". Presenting puts keyboard focus on the canvas.
  Presenting, **Full screen** (an icon button beside Exit presentation, or **F**) fills the screen and **Exit full
  screen** (F or Esc) comes back; it follows the browser's own Esc and F11. It isn't shown where the browser can't go
  full screen (an iframe without `allow="fullscreen"`, iOS Safari). Leaving the presentation leaves full screen too.
  Embeds and the HTML viewer have no presentation, so no full screen.
- **Language** (View ▸ **Language…**, Ctrl+K "Language…"; docs/I18N.md) is the app's language, never "locale" or
  "translation" in the UI. The browser's language is the default (**Browser default**, first in the list, says which it
  is now); a choice is kept in this browser and Clear everything forgets it. Languages are listed by their own name.
  When the app isn't in English, the View menu's row also says "Language" in English, and Ctrl+K always matches
  "language", so the way back is never in a language the person can't read. A machine-translated language says so in
  the dialog, with **Suggest a better translation**. Translating never touches the diagram (labels, notes, titles),
  product names or files. Right-to-left languages mirror the chrome, never the diagram.

## Mouse and trackpad

The shortcuts sheet's Mouse rows (`src/components/ShortcutsDialog.tsx`) say these in short; keep the two
in step:

| Gesture                              | Does                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| Right-click                          | Context menu for the canvas, a node, an edge or a boundary                      |
| Double-click canvas                  | Quick-add a stencil at the cursor, its name open to type                        |
| Double-click node / edge / boundary  | Rename it in the inspector: its Label focused, all selected                     |
| Double-click text / note / zone      | Edit its text in place, all selected                                            |
| Drag on the canvas                   | Selection box (Ctrl/⌘: only inside; Shift: adds). Live, presenting, embeds: pan |
| Shift / Ctrl / ⌘ + click             | Add to or take out of the selection                                             |
| Scroll, two-finger swipe             | Pan (Shift + scroll: sideways). In an embed the wheel scrolls the page          |
| Ctrl / ⌘ + scroll, pinch             | Zoom at the pointer                                                             |
| Space + drag, middle-drag            | Pan, even starting on a node                                                    |
| Drag from a handle                   | Connect: drop on a node (anywhere on it), or on empty canvas to add one         |
| Click a selected node's +            | Quick-add the next node there, connected (drag it: connect)                     |
| Drag a selected edge's end           | Move that end onto another node; anywhere else it snaps back                    |
| Hold a node on an edge               | Lights the edge up; drop to insert the node in between (Ctrl/⌘: don't)          |
| Drag a node                          | Lines up with nearby edges, centres and equal gaps, else the grid               |
| Ctrl / ⌘ while dragging              | Move freely: no guides, no grid                                                 |
| Alt + drag                           | Duplicate what you drag                                                         |
| Drag a node across a boundary's edge | Joins it (its outline lights up) or leaves it (dashed)                          |
| Drag a boundary's corner             | Resize; it takes in the nodes now inside it and lets go of the rest             |

## Process

Every feature batch ends with a **UX review gate** before new work starts: a designer agent walks the
whole app against these rules, flags clutter and inconsistency, and simplifies (removes, merges, moves to
context) before adding. Findings go in a new `docs/design-review/YYYY-MM-DD-short-slug.md` fragment.
