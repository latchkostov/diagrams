# Release notes

Changes to habits people already have. The app has no "what's new" panel, so they're noted here.

## Import docker-compose files (2026-10)

One habit changes: **Open…** and a drop take several files at once. Opening one file works as before. New:

- **Open…**, a drop and **Import from ▸ Paste text…** read a **docker-compose** file. Drop it with its
  `docker-compose.override.yml` (and a `.env` file it names) to merge them the way Compose does. Each import
  makes a new diagram in Your diagrams: services on their stencils (PostgreSQL, Kafka, NGINX…), the networks
  as boundaries, and connections found in the files, including settings such as `DATABASE_URL` or `INPUT_TOPIC`.
- The toast's **Details** opens the **Import report**: which stencils are guesses (one click picks another),
  which setting each connection came from, and what wasn't drawn or couldn't be read, and why. Ctrl+K "Import
  report" opens it again while the diagram is open.
- Everything is read on this device. Setting values are used only to find host names and are never kept. With
  **New diagrams are private** on, the import is private; otherwise the report offers **Make it private**.
- Kubernetes manifests, AsyncAPI documents and Terraform plans are recognised, and say they can't be imported
  yet.
- New stencil: **MySQL** (MariaDB too).

## UX review, round 13 (2026-10)

Two habits change:

- **Double-click quick-add opens the new node's name.** Pick a stencil and type: the words name the node, as after
  Alt+arrow, the "+" and a dropped connection. They used to reach the canvas, where a T added a text and an L went
  live. One Ctrl+Z takes the node, its connection and their names, however long you take to type them (also after
  Alt+arrow, the "+", a dropped connection, or a rail or Ctrl+K add named with Enter straight after).
- **Shift+drag on empty canvas adds to the selection**, as Shift+click does. A plain drag still replaces it.

Also:

- An Undo toast ("Payments service left AKS · Undo") goes as soon as Ctrl+Z or the canvas's Undo runs, since its
  button would then reverse a different change.
- Esc clears the selection and keeps keyboard focus on the node, so Tab carries on from there; Esc never selects.
- Ctrl+K finds **Present**. Presenting puts keyboard focus on the canvas.
- In the AI panel, Advanced and the on-device box no longer squeeze the conversation: past 60% of the panel, they
  scroll.
- The shortcuts sheet lists the File keys (Ctrl+O, Ctrl+S, Ctrl+Shift+S) and slow motion's ← →.

## Private diagrams (2026-10)

No habit changes unless you use it. New:

- **File ▸ Privacy ▸ Private diagram** keeps a diagram on this device: no share links or embed codes, no saves to
  Google Drive, OneDrive or Dropbox, and no AI (the page's tools, Copy for AI and copied prompts are off). A
  **Private** lock sits beside its title; click it to read what that means or to make it not private again.
  Saving and exporting to this device work as before, and an exported file stays private when it's opened again.
- **File ▸ Privacy ▸ New diagrams are private** makes everything you start, import or open from this device
  private.
- In a private diagram the AI panel can allow Chrome's on-device model, which runs on this device.

## Structure and bulk (2026-10)

Three habits change:

- **Boundaries keep up.** A node belongs to the boundary around its centre, as before, but you now see it while you
  drag: the boundary it will be in lights up, and one it's leaving shows dashed. Drop a member so it pokes out of
  its boundary and the boundary grows to hold it; it used to stay the same size, and a node dragged a little too
  far quietly left. Leaving now says so, with Undo. Resizing a boundary takes in the nodes now inside it and lets
  go of those outside. Boundaries never shrink by themselves: Fit to contents does that.
- **Tab moves between nodes.** The canvas is one stop in the page's Tab order. Inside it, Tab and Shift+Tab step
  through the nodes in reading order, selecting each one; past the last, Tab leaves the canvas. Tab used to visit
  every node and then every edge, in the order they were made. Edges are reached from a node with Ctrl+Alt+] and
  Ctrl+Alt+[, and Ctrl+Alt+arrows (⌃⌥ on a Mac) go to the nearest node that way.
- **Route from side and Route to side are one row**, Route ▸, on the edge's menu.

Also new:

- With several things selected, the inspector edits them together: the nodes' stencil, boundary and shared
  simulation settings, the edges' relationship and label, and the colour of annotations and boundaries. "Mixed"
  shows where they differ. Each change is one undo step.
- Select similar (a node's or an edge's right-click, Ctrl+K) selects every node of that stencil, or every edge of
  that relationship.
- Tidy up (a selection's right-click, the inspector, Ctrl+K) lays out just the selected nodes by their connections,
  without moving anything else. Align and Distribute no longer stack nodes on top of each other.

## Flow building (2026-10)

One habit changes:

- **A rail click respects the selection.** With exactly one node selected, clicking a stencil in the rail adds
  it after that node, connected, as Ctrl+K's "Add …" already did. The rail's footer says so ("A click adds
  after Payments service"). With nothing selected, or several things, it adds an unconnected node in free
  space, as before. Drag the stencil instead to place it anywhere.

Also new:

- A selected node shows a "+": click it to pick the next node, which lands beside it, connected and ready to
  name. Alt+arrow does the same from the keyboard (→ and ↓ downstream, ← and ↑ upstream), and Alt+Shift+arrow
  adds a copy of the node there. On the canvas, Alt+← and Alt+→ no longer go back or forward in the browser.
- A new connected node's name editor has one more field: Tab, Tab names its connection.
- Drag either end of a selected edge onto another node to rewire it; it keeps its label and settings. From the
  keyboard, the edge's menu and Ctrl+K have Reconnect ▸ From / To.
- Hold a new node (or a stencil from the rail) over an edge for a moment and drop it to put it in between, or
  use Insert node on the edge's menu or in Ctrl+K.
- Dragging a stencil shows the node card it makes and an outline where it will land.
- Quick-add finds stencils the way the rail does: "pg" finds PostgreSQL, "go" the Go service.

## Drawing precision (2026-10)

Two habits change:

- **Esc saves a label instead of cancelling it.** In a node's label editor Esc used to throw the edit away; now
  it keeps it, as it already did for text and notes, and as Figma and tldraw do. Every text box on the canvas
  works the same way: Enter or Esc saves, Tab goes to the next field (label, then subtitle). Changed your mind?
  Ctrl+Z (⌘Z on a Mac) right after takes the edit back.
- **Snap to grid is now Snapping, and the arrow keys stay on the grid.** Dragged nodes line up with their
  neighbours' edges and centres, and with equal gaps, as well as with the grid. Hold Ctrl (⌘ on a Mac) while
  dragging to place something freely. An arrow key moves the selection to the next 10 px grid line and
  Shift+arrow moves it 50 px; they used to move 1 px and 10 px, which they still do with Snapping turned off
  (Show ▸ Snapping).

Also new:

- Enter edits the selected node, edge, boundary or annotation (F2 still works).
- Label editors stay readable when you're zoomed out.
- Ctrl+K opens at once, and what you type straight after it goes into its search.

## Drawing basics (2026-10)

Two habits change, to work like Figma, tldraw, Excalidraw and draw.io:

- **The wheel pans; Ctrl/⌘+wheel zooms.** A two-finger swipe moves the canvas in both directions, a pinch
  zooms, and Shift+wheel pans sideways on a mouse. Mouse users who zoomed with the wheel now hold Ctrl (⌘ on a
  Mac). Space+drag and the middle button pan from anywhere, even starting on a node.
- **A drag on empty canvas draws a selection box** (it picks what it touches; hold Ctrl/⌘ for only what's
  inside). Shift+click now adds to the selection, like Ctrl/⌘+click. Live view, presentation and embeds still
  pan with a drag, and an embed still lets the wheel scroll its page.

Also new:

- Drop a connection on empty canvas to pick the next node: it lands there, connected, ready to name.
- A connection dropped anywhere on a node connects to it; the node lights up first, and handles are easy to
  hit at any zoom.
- Ctrl+D, Ctrl+V and Alt+drag never put a copy on top of anything. Ctrl+V pastes at the pointer.
- Shift+2 zooms to the selection (also in Ctrl+K).
