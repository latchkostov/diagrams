# Drawing UX: back to the drawing board

Research and plan, written 2026-10-11. Nothing here is built yet.

The goal is for the editor itself to feel great: adding and connecting nodes, alignment and snapping,
selection and bulk edits, edges and their labels, keyboard flow, undo, text editing, copy and paste,
boundaries and navigation. The live simulation is out of scope, except where editing touches it.

**Method.**

- **Benchmark.** draw.io, Excalidraw, tldraw, Figma/FigJam and Lucidchart, plus Miro, Whimsical and
  Eraser, from their docs, shortcut references and (for Excalidraw and tldraw) GitHub source.
  tldraw was also tried hands-on in Chromium: two rectangles, Ctrl+D and the wheel. Excalidraw's canvas
  was opened, but it can't be inspected from the DOM, so its cells come from source.
- **Our editor, hands-on.** The dev server ran on port 5591 with the public Kafka order pipeline example
  (15 nodes, 15 edges, one boundary) and a blank diagram. It was walked at 1280×800 and 1440×900 with
  the mouse, a trackpad-style wheel (small `deltaX`/`deltaY` steps), Ctrl+wheel (what a pinch sends) and
  the keyboard only.
- **Scripted with Playwright,** so gestures, positions and timings are exact. localStorage was cleared
  before every flow.
- **Responsiveness.** Event Timing (`durationThreshold: 16`) and `requestAnimationFrame` gaps were
  recorded at 1× and under 4× CPU throttling.
- **Screenshots:** `docs/screenshots/drawing-ux/` (public examples only; `-1280` and `-1440` give the
  viewport).

---

## Summary: the 10 changes that would most improve how drawing feels

1. **Drop a connection on empty canvas to create the next node.** Today the drop does nothing
   (`04-connect-drop-on-empty`). Instead, the quick-add search opens at the drop point; pick a stencil
   and it's added there, already connected. This is the single biggest speed-up, and every benchmark
   tool has a version of it.
2. **Connect handles that are easy to hit.** At the fitted zoom a handle is **4.4 px** on screen
   (1280×800, zoom 0.49). Give it a 20 px invisible hit area, let a drop anywhere on a node connect to it,
   highlight the node you'll connect to, and keep a crosshair cursor for the whole gesture.
3. **Trackpad-native navigation.** Today a two-finger scroll _zooms_, and a horizontal two-finger swipe does
   **nothing**. Make the wheel and trackpad pan, and pinch or Ctrl+wheel zoom. Space+drag and middle-drag
   pan everywhere, even over a node. Figma, tldraw, Excalidraw, draw.io and Lucid all work this way.
4. **Drag on empty canvas draws a selection box.** Shift+click and Ctrl+click both add to the selection.
   Today a plain drag pans, Shift+drag box-selects, and Shift+click _replaces_ the selection. Live view,
   presentation and embeds keep drag-to-pan.
5. **Smart guides and equal spacing while dragging.** Show alignment lines to nearby nodes' edges and
   centres, snap to them, and show equal-gap hints. Hold Ctrl/Cmd to drag freely. The guides appear
   only during a drag. This replaces most uses of Align ▸ (6 clicks today for three nodes).
6. **Copies never land on top of the original.** Ctrl+D places the copy beside the original in free space,
   in the flow direction, and repeats your last offset. Ctrl+V pastes at the pointer. Alt-drag
   duplicates. Today both Ctrl+D and Ctrl+V overlap the original by 30 px (`08-duplicate-overlaps`,
   `09-paste-not-at-pointer`), which breaks the rule that nothing overlaps.
7. **Keyboard creation flow.** With a node selected, **Alt+→/↓/←/↑** opens quick-add beside it in that
   direction, connected. The new node opens with its label selected, so a chain is "Alt+→, type, Enter,
   type a name, Enter". **Enter** edits the selected node's label, and inline editors stay readable at
   any zoom (today their text is about 6 px at the fitted zoom). Ctrl+K and quick-add keep keys typed
   before they open: today a fast "Ctrl+K kafka" makes a Text annotation reading "o"
   (`28-ctrlk-typeahead-lost`).
8. **Edges you can grab.** A selected edge shows its two ends: drag an end to reconnect it, and drop a node
   onto an edge to insert it (A→B becomes A→N→B). Today rewiring means delete and redraw, and inserting a
   node takes about 6 actions.
9. **Boundaries that keep up.** While you drag a node, the boundary it will join or leave lights up.
   Dropping it near the edge grows the boundary to fit, instead of silently dropping the node out of it
   (`11-boundary-no-grow`). Nodes added inside a boundary keep it fitted.
10. **Zoom to selection and bulk edit.** Shift+2 zooms to the selection, and the palette finds it.
    With several edges selected, the inspector edits Relationship and Label for all of them. With several
    nodes selected, it edits Boundary and Stencil; with annotations, Colour. Mixed values show "Mixed".

---

## How we compare

Sources: each tool's official shortcut reference, help centre or GitHub source (listed at the end).
tldraw was also tried hands-on. ✓ = full, ◐ = partial, ✗ = none, ? = not verified.
Miro, Whimsical and Eraser are lighter checks: Miro's help centre blocked fetching, and Eraser's docs are
mostly about diagram-as-code.

| Capability                               | draw.io | Excalidraw | tldraw | Figma / FigJam | Lucid | Miro | Whimsical | Eraser | **Us**                                                       |
| ---------------------------------------- | :-----: | :--------: | :----: | :------------: | :---: | :--: | :-------: | :----: | ------------------------------------------------------------ |
| Quick-add next node, connected           |    ✓    |     ✓      |   ◐    |    FigJam ✓    |   ✓   |  ◐   |     ✓     |   ?    | ◐ Ctrl+K "Add X after Y" only                                |
| Connector dropped on empty canvas        |    ◐    |     ◐      |   ◐    |       ◐        |   ✓   |  ?   |     ?     |   ?    | ✗ nothing happens                                            |
| Smart guides and equal spacing           |    ✓    |     ✓      |   ✓    |       ✓        |   ✓   |  ✓   |     ✓     |   ?    | ✗                                                            |
| Align / distribute / tidy                |    ✓    |     ✓      |   ✓    |       ✓        |   ✓   |  ✓   |     ✓     |   ?    | ◐ menu and inspector, no keys, no tidy                       |
| Snap to grid                             |  ✓ on   |   ✓ off    | ✓ off  |       ◐        |   ✓   |  ✓   |     ✓     |   ?    | ✓ on, 10 px (dots every 20)                                  |
| Arrow-key nudge                          |    ✓    |     ✓      |   ✓    |       ✓        |   ✓   |  ✓   |     ?     |   ?    | ◐ 1 / 10 px, leaves the grid                                 |
| Box select: touch vs contain             |    ✓    |     ◐      |   ✓    |       ◐        |   ?   |  ?   |     ?     |   ?    | ◐ Shift+drag, contain only                                   |
| Modifier-drag duplicate                  | ✓ Ctrl  |   ✓ Alt    | ✓ Alt  |     ✓ Alt      |   ✓   |  ✓   |     ✓     |   ?    | ✗ Alt-drag just moves                                        |
| Smart duplicate (no overlap, repeat gap) |    ✗    |     ✗      |   ✓    |       ✓        |   ?   |  ?   |     ?     |   ?    | ✗ +30 px, on top of the original                             |
| Paste at cursor / in place               |    ◐    |  ✓ cursor  |   ✓    |       ✓        |   ?   |  ?   |     ?     |   ?    | ◐ offset; "Paste here" in the right-click                    |
| Waypoints, reconnect ends, routing       |    ✓    |     ✓      |   ◐    |       ✓        |   ✓   |  ✓   |     ?     | ◐ auto | ◐ auto-routed; pinned sides; ends can't be moved             |
| Edge labels draggable / several          |    ✓    |     ◐      |   ✓    |       ✓        |   ✓   |  ?   |     ?     |   ?    | ◐ one label, auto-placed, overlap-free                       |
| Insert a node by dropping it on an edge  |    ✓    |     ✗      |   ✗    |       ✗        |   ?   |  ?   |     ?     |   ?    | ✗                                                            |
| Copy/paste style, format painter         |    ✓    |     ✓      |   ◐    |       ✓        |   ✓   |  ✓   |     ✓     |   ?    | ✗ (by design: styles are semantic)                           |
| Auto-layout of a selection               |    ✓    |     ✗      |   ◐    |       ◐        |   ✓   |  ?   |     ✓     | ✓ all  | ◐ whole diagram only                                         |
| Keyboard-only creation                   |    ✓    |     ✓      |   ◐    |    FigJam ✓    |   ◐   |  ◐   |     ✓     |   ◐    | ◐ Ctrl+K chain, F2; keys lost on first open                  |
| Command palette                          |    ?    |     ✓      |   ✗    |       ✓        |   ?   |  ✓   |     ◐     |   ◐    | ✓ Ctrl+K                                                     |
| Zoom: fit / selection / 100%             |    ✓    |     ✓      |   ✓    |       ✓        |   ◐   |  ✓   |     ✓     |   ?    | ◐ Shift+1, Shift+0; no zoom to selection                     |
| Containers: move together, grow          |    ✓    |     ✓      |   ✓    |       ✓        |   ✓   |  ✓   |     ?     |   ◐    | ◐ move together; never grow; silent membership               |
| Text editing (Enter, Esc, new = edit)    |    ✓    |     ✓      |   ✓    |       ✓        |   ✓   |  ✓   |     ✓     |   ?    | ◐ F2 / double-click; Enter does nothing; Esc differs by kind |
| Lock                                     |    ✓    |     ✓      |   ✓    |       ✓        |   ✗   |  ✓   |     ✓     |   ?    | ✗ (by design)                                                |
| Z-order shortcuts                        |    ✓    |     ✓      |   ✓    |       ✓        |   ✓   |  ✓   |     ✓     |   ?    | ◐ menus only (by design)                                     |
| Multi-edit with "Mixed" values           |    ✓    |     ✓      |   ✓    |       ✓        |   ✓   |  ?   |     ?     |   ?    | ◐ align, boundary, delete; relationship via right-click      |
| Select similar / connected               |    ✓    |     ✗      |   ◐    |       ✓        |   ✓   |  ?   |     ◐     |   ?    | ✗                                                            |
| Library drag preview, click-to-add       |    ✓    |     ✓      |   ✗    |       ✓        |   ✓   |  ✓   |     ✓     |   ?    | ◐ browser ghost; click adds in free space                    |
| Hover affordances (ports, targets)       |    ✓    |     ◐      |   ◐    |       ✓        |   ✓   |  ✓   |     ✓     |   ?    | ◐ handles fade in, 4.4 px at fit; no target highlight        |
| Wheel / trackpad pans, pinch zooms       |    ✓    |     ✓      |   ✓    |       ✓        |   ✓   |  ?   |     ✓     |   ?    | ◐ pinch zooms; scroll zooms; horizontal swipe does nothing   |
| Undo as one step per gesture             |    ✓    |     ?      |   ?    |       ?        |   ?   |  ?   |     ?     |   ?    | ✓                                                            |

**What the leaders do that we should copy** (the tool that does it best is in brackets):

- **Connector into empty space becomes the next node** (Lucid's shape picker; draw.io's copy on connect).
  It turns a dangling-arrow mistake into "add the next step". → D1.
- **Directional quick-add from the keyboard** (Whimsical Alt+Arrow; Excalidraw Ctrl+Arrow; draw.io
  Alt+Shift+Arrow clone-and-connect). → D3.
- **Snapping you barely notice** (tldraw: an 8 px screen threshold, gap snaps, and snapping only engages
  when the pointer slows down, so fast drags aren't sticky). → D6.
- **Duplicates that don't overlap and repeat the last gap** (tldraw: the width + 10 px to the right, seen
  hands-on; Figma repeats an Alt-drag's offset). → D9.
- **Shift+0 / 1 / 2** for 100%, fit and selection (Figma, tldraw, Excalidraw). → D10.
- **Box select that touches by default, with one modifier for contain** (tldraw: Ctrl). → D5.
- **Dropping a shape onto an edge splits it** (draw.io). → D8.
- **"Mixed" in a shared inspector** (Figma, tldraw). → D11.

**What the leaders do that we won't** (see "Not doing"): manual waypoints, draggable edge labels, a style
clipboard, lock, and tool-mode toolbars. Those tools need them because they have no router, no semantic
styles and no stencils.

---

## Findings from our audit

### What already works well

- **Ctrl+K "Add X after Y".** Ctrl+K with a node selected offers "Add Kafka Topic _after Order service_".
  Enter adds it downstream, connected, and selected, so the next Ctrl+K chains from it
  (`16-ctrlk-added-connected`). This is the best creation flow we have; it just isn't on the canvas.
- **Free placement.** A click in the rail or the palette lands on the free spot nearest the view's centre
  (`placeFree`), clear of nodes and edges.
- **Auto-routed, non-overlapping edges and label pills.** The router and label placer do what users of
  other tools do by hand with waypoints and label drags. Keep this as the default (rule 10).
- **Undo.** A drag is one step and undoes exactly (measured: (2150, 770) back to (1940, 640)). Inspector typing
  coalesces, and menus, inspector and gestures all land in the same history.
- **Menus.** The node, edge, selection and canvas menus are within budget and searchable (`12-node-menu`,
  `13-selection-menu`, `26-canvas-menu`).
- **No focus ring on mouse use.** Clicking a node or an edge doesn't show a focus outline
  (`:focus-visible` is false). Node icons are `draggable=false`, so dragging a node by its icon never
  starts a native image drag.
- **Hover is quick.** Sweeping the pointer across six nodes: the slowest pointer event was 16 ms at 1×
  and 24 ms at 4× throttling (dev build). Handles fade in within 120 ms.

### Friction, flow by flow

Counts are for the Kafka example at 1280×800. "Click" includes right-clicks; a "precise drag" means
hitting a handle.

**F1. Connecting to something new is a two-step chore** (`03-connect-drag-to-empty`, `04-connect-drop-on-empty`)

- A connection dropped on empty canvas does nothing: no node, no edge, no feedback.
- "Add a Kafka topic connected to the selected Order service" costs:

  | Path                                                                    | Cost today                                      | Notes                                                                                                               |
  | ----------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
  | Ctrl+K, type "kafka topic", Enter                                       | 13 keystrokes, 0 clicks                         | The best path (`15-ctrlk-add-after`). On a first open, keys typed in the first ~360 ms (dev) go to the canvas (F9). |
  | Rail click, then drag a handle to the new node                          | 1 click + 1 precise drag                        | The rail ignores the selection: the topic lands near the view's centre, unconnected (`17-rail-click-unconnected`).  |
  | Double-click canvas, type, Enter, then drag a handle                    | 1 double-click + 12 keystrokes + 1 precise drag | `18-quick-add`                                                                                                      |
  | Right-click ▸ Add node here ▸ Messaging ▸ Kafka Topic, then drag        | 4 clicks + 1 precise drag                       |                                                                                                                     |
  | **Proposed:** drag from Order service to empty space, type "kaf", Enter | 1 drag + 4 keystrokes                           | Or Alt+→, "kaf", Enter: 5 keystrokes.                                                                               |

- The rail and Ctrl+K disagree: the same "add a stencil" with Order service selected connects in one place and
  not the other (rule 7).

**F2. Handles are tiny at the zoom people actually work at** (`02-node-hover`)

- At the fit zoom (0.49 at 1280, 0.47 at 1440), a handle is 4.4 × 4.4 px on a 127 × 35 px node.
- `connectionRadius` (28) helps at the target end, but the start needs a pixel-precise press.
- While you drag a connection, the cursor flickers between `pointer` (passing over edges), `move`
  (over nodes) and `grab`. No cursor says "connecting".
- The target node gets no highlight (`22-connect-over-target`). You only find out after you let go.

**F3. The trackpad zooms when you meant to pan**

- A vertical two-finger scroll (5 × 40 px wheel deltas) zoomed out from 0.49 to 0.37. A horizontal swipe
  did nothing at all.
- To pan you drag the empty canvas. On a full diagram there's little of it, and Space+drag that starts on a
  node moves the node instead of panning.
- Pinch (Ctrl+wheel) zooms correctly.
- tldraw, hands-on: the same wheel input panned 240 px at 100% zoom. Excalidraw shows "To move canvas, hold
  Scroll wheel or Space while dragging".

**F4. Selection gestures are the opposite of every other tool** (`05-box-select-partial`, `24-three-nodes-inspector`)

- A plain drag on empty canvas pans. Box select needs Shift+drag, and only the shortcuts sheet says so.
- **Shift+click replaces the selection** (measured: inventory, then Shift+click payments, left only
  payments). Ctrl+click adds.
- The box selects only fully contained nodes. Edges between them come too, so the box above selected
  "1 node, 2 edges", and Align didn't apply.
- Mid-drag, the selection opened the inspector (below 1680 px), which narrowed the canvas under the
  pointer (`05-box-select-partial-1280`).

**F5. No alignment help while dragging** (`07-drag-no-guides`)

- There are no guides and no snapping to other nodes, only the 10 px grid. The dots are drawn every 20 px,
  so half the snap positions sit between dots.
- Aligning three nodes is Ctrl+click ×3, right-click, Align ▸, Vertical middles: 6 clicks. The inspector's
  Align buttons save one.
- Arrow keys nudge by 1 px even with Snap to grid on. Two presses left the gateway at x = 422, off the grid
  for good.

**F6. Duplicate and paste overlap the original** (`08-duplicate-overlaps`, `09-paste-not-at-pointer`)

- Ctrl+D puts the copy at +30, +30 flow px. That's 14 px on screen, on top of the original.
- Ctrl+V ignores the pointer. With the pointer at (440, 680), the paste landed at (546, 276), overlapping the
  copied node.
- Paste here (right-click) does place at the pointer. Alt-drag just moves the node.
- A fan-out ("another consumer like this one") is Ctrl+D, drag the copy clear, then a precise drag to
  connect it: 1 key + 2 drags.

**F7. Text editing has two sets of rules** (`29-node-editor-esc-cancels`)

- The inline label editor scales with the canvas. At the fit zoom its text is about 6 px, and its hint
  ("Enter saves, Esc cancels") about 5 px. You type into something you can't read. Round 7 fixed the
  same problem for hover cards by scaling them by 1/zoom.

- **Enter** on a selected node does nothing, and neither does typing. Only F2 or a double-click starts editing.
- A new node keeps the stencil's name ("Kafka Topic") and doesn't offer to rename. A new Text or Note opens
  its editor at once.
- **Esc cancels** a node's label edit ("Enter saves, Esc cancels"), but **commits** an annotation's text
  (round 4). The same key does opposite things.

**F8. Edges can't be rewired** (`10-edge-selected`, `27-edge-label-edit`)

- A selected edge shows no end handles (`.react-flow__edgeupdater`: 0). Moving an end to another node
  means deleting the edge and drawing a new one, which loses its label, relationship and settings.
- You can't drop a node onto an edge to insert it. A→B becomes A→N→B by deleting the edge, adding N and
  drawing two connections: about 6 actions.
- Label placement is automatic and can't be moved by hand. That's fine by default (rule 10). A long label
  on a short edge has no way out but shorter text.
- Deleting a node in the middle of a chain deletes both its edges. That's expected; healing them is a
  nice-to-have.

**F9. Keystrokes are lost before Ctrl+K opens** (`28-ctrlk-typeahead-lost`)

- The palette chunk preloads 3 s after start. Within that window Ctrl+K took **359 ms** to open in dev.
- Typing "kafka topic" at 25 ms per key sent the first letters to the canvas: `t` (the Text shortcut) added a
  Text, and the rest landed in it.
- Quick-add (double-click) has a smaller window of the same kind: its search focuses about 24 ms after
  opening.

**F10. Boundaries don't follow their nodes** (`11-boundary-no-grow`)

- A member dragged towards a boundary's edge quietly leaves it once its centre crosses the line
  (Boundary: None in the inspector). The boundary doesn't grow, and nothing during the drag says the node
  is about to leave or join.
- Fit to contents exists, but only on the boundary's right-click.

**F11. Navigation**

- Shift+2 (zoom to selection in Figma, tldraw and Excalidraw) does nothing. There's no zoom to selection
  anywhere; Ctrl+K's node search centres a node at 90% at least.
- At the fit zoom a node title is **6.6 px** on screen (13.5 px × 0.49), so editing a dense diagram means
  zooming in and out constantly.
- The diagram isn't refitted when the inspector opens on a selection (round 7, P3): Storefront was half
  under the stencil rail in most shots at 1280 (`08-duplicate-overlaps`).

**F12. Multi-select editing is thin** (`24-three-nodes-inspector`)

- Two nodes show Align, Add boundary and Delete. Nodes can't change stencil or boundary together.
- Several edges can change Relationship from the right-click (Relationship ▸), but not in the inspector,
  and not their labels.
- There's no "select all like this" (every edge of this relationship, every node of this stencil).

**F13. The stencil rail's drag uses the browser's ghost** (`17-rail-click-unconnected`; a headless
browser can't capture the native drag image)

- Dragging a stencil drags the browser's picture of the rail row, without a node preview or snapping.
- The node lands centred on the drop point, which is right, but you can't see where until you let go. You
  can't drop it onto an edge or a handle.

### App-like or not: leaks during drawing

- **Stray text selection while connecting: seen, and being fixed elsewhere.** Dragging a connection from
  Order service selected the labels and icons of five nodes
  (`window.getSelection()` read "orders.created.v1 OrderPlaced · keyed by orderId Inventory service…").
  See `03-connect-drag-to-empty` and `22-connect-over-target`. The fix is in progress on
  `fix/no-text-selection-on-canvas`, so it isn't proposed again here.
- **Image drag ghosts: none.** Node icons are `draggable=false`, and dragging a node by its icon started no
  `dragstart`. The stencil rail's drag is an intended native drag, but its ghost is the rail row (F13).
- **Cursor flicker: yes, while connecting** (F2). Dragging a node keeps `move` throughout.
- **Focus outlines on mouse use: none.** A clicked node or edge isn't `:focus-visible`. Keyboard focus
  still shows the ring.

### Responsiveness

Dev build, Kafka example, Chromium, Event Timing (events of 16 ms or more) and frame gaps:

| Interaction                          | 1×                                           | 4× CPU throttle                                           |
| ------------------------------------ | -------------------------------------------- | --------------------------------------------------------- |
| Hover sweep across 6 nodes           | worst event 16 ms                            | worst event 24 ms                                         |
| Drag Order service (6 edges reroute) | frames p50 17 / p90 17 ms; worst event 32 ms | frames p50 17 / p90 33 ms, max 117 ms; worst event 120 ms |
| Ctrl+K, first open (chunk load)      | 359 ms                                       | -                                                         |
| Ctrl+K, after that                   | 49 ms                                        | -                                                         |
| Double-click quick-add               | 19–24 ms                                     | -                                                         |

- Hover and drag are fine at 1×. Under throttling a drag drops frames: re-routing on every pointer move,
  as the backlog already says for 150 nodes (80–104 ms per event at 4×).
- Smart guides (change 5) must not add to that. Build the candidate lines once at drag start (an index of
  the other nodes' edges and centres), and per move look up only the nearest line on each axis. Route edges
  for the moved node only, or on idle (backlog item).

---

## Proposed improvements

Each proposal gives the user-facing behaviour, the interaction spec, what shows by default and on demand,
the effort (S ≤ 1 day, M ≤ 3 days, L more), the risk, and the rule it serves. **[Changes behaviour]**
and **[Vocabulary]** mark anything that alters what people already know.

### D1. Drop on empty canvas: create and connect

- **For users:** drag from a node's edge into empty space, let go, pick a stencil, and it's there,
  connected.
- **Spec:**
  - On `onConnectEnd` without a target, open the quick-add menu (the double-click one, searchable) at the
    drop point.
  - It lists **Recently used** first, then the stencils whose role usually sits downstream of the source
    (a topic after a service, a consumer after a topic). The search filters everything.
  - The closest precedent is Lucid's shape picker on an unattached line end. draw.io's Copy on Connect
    is the zero-UI version.
  - Picking one adds the node centred on the drop point (snapped to grid or guides) and the edge from the
    source. Relationship inference applies as for any connect.
  - The new node's label editor opens with the text selected (see D7).
  - Esc or a click away cancels: nothing is added.
  - While dragging over empty space the dashed line ends in a small ghost "+" at the pointer, so the drop
    reads as "add here".
  - Cursor: crosshair for the whole gesture.
- **Default:** always on. No new chrome.
- **Effort:** S. **Risk:** low (React Flow's `onConnectEnd` with `connectionState`).
- **Rules:** 3 (context over chrome), 9 (teach in place: add one line to the first-run hint and the
  shortcuts sheet).

### D2. Handles you can hit, and connect feedback

- **For users:** starting a connection is forgiving; you see what you'll connect to before you let go.
- **Spec:**
  - Each handle keeps its visual dot (fade in on hover, as now), with a hit area at least 20 px on screen at
    any zoom (scaled by 1/zoom with a minimum).
  - While connecting:
    - a drop anywhere on a node connects to it (the side is picked from geometry, as edges already are);
    - the target node gets the selection outline in the accent tint;
    - an invalid target (itself, an annotation that takes no edges) shows `not-allowed`;
    - the cursor stays `crosshair` over everything.
  - Hovering a node shows its four handles. Hovering a selected node also shows D3's "+".
- **Default:** on. **Effort:** S. **Risk:** low; check that the bigger hit areas don't swallow node drags
  near the edge (keep them outside the card by half their size).
- **Rules:** 7 (consistent affordances), 8 (app, not page).

### D3. One "+" to grow the flow, by pointer or keyboard

- **For users:** the fastest way to add "the next thing" after a node.
- **Spec:**
  - A selected single node shows one small "+" chip on its downstream side (right for left-to-right
    diagrams, bottom for top-to-bottom), 16 px off the card.
  - Clicking the chip opens quick-add, and the pick lands at `placeNextTo` (as Ctrl+K does), connected.
  - Dragging the chip is a connect gesture (D1).
  - Keyboard: **Alt+→/↓/←/↑** opens the same quick-add for that side (← and ↑ are upstream: the new node
    connects _into_ the selected one).
  - **Alt+Shift+arrow** skips the menu and adds a copy of the selected node there, connected (draw.io's
    clone-and-connect), for fan-outs.
  - Only on a single selection, never while live or presenting, and hidden in exports.
- **Default:** the chip shows only on a selected node. No hover arrows on every node: draw.io's four blue
  arrows per hover are the clutter we avoid.
- **Effort:** M. **Risk:** medium: the chip must avoid edge labels and other nodes (place it on the free
  side if the downstream side is taken).
- **Rules:** 2 (progressive disclosure), 3, 8.

### D4. Navigation: wheel pans, pinch zooms **[Changes behaviour]**

- **For users:** a trackpad moves the canvas like every design tool; a mouse wheel scrolls it.
- **Spec:**
  - `panOnScroll`: wheel and two-finger pan (both axes). Shift+wheel pans sideways on a mouse.
  - Ctrl/Cmd+wheel and pinch zoom at the pointer.
  - Space+drag pans anywhere, even starting on a node (cursor `grab`, then `grabbing`). Middle-drag
    pans.
  - Keyboard: **Ctrl+= / Ctrl+-** zoom in and out (we keep the browser from zooming the page), **Shift+1**
    fits, **Shift+2** zooms to the selection (D10), **Shift+0** is 100%.
  - Embeds keep today's rule: the wheel scrolls the page, and pinch or Ctrl+wheel zooms the diagram.
- **Default:** on. Mouse users who liked wheel-zoom lose it. Detecting a "mouse" by its deltas is
  unreliable, so there's no auto mode. The shortcuts sheet's Mouse section says "Ctrl + scroll: zoom".
- **Effort:** S. **Risk:** medium (habit). Do it once, in batch 1, and say so in the release note.
- **Rules:** 8 (app, not page).

### D5. Selection gestures that match other tools **[Changes behaviour]**

- **For users:** drag on empty canvas to select; Shift+click to add.
- **Spec:**
  - Editing: a drag on empty canvas draws the selection box (`selectionOnDrag`); panning is D4's gestures.
  - The box selects nodes it **touches**, as Figma, tldraw and Excalidraw do; hold Ctrl/Cmd for "fully inside
    only" (tldraw's modifier).
  - Edges are selected only when both ends are, and they don't count against "Align" (Align uses the
    nodes in a mixed selection).
  - **Shift+click** and Ctrl/Cmd+click toggle an item in the selection.
  - The inspector opens on pointer-up, never mid-drag (F4).
  - Live, presentation and embeds: a drag still pans (there's nothing to select for editing).
- **Default:** on. **Effort:** S. **Risk:** medium (habit). Pair it with D4 so there's always a pan
  gesture that doesn't need the keyboard (two-finger or wheel).
- **Rules:** 7, 8.

### D6. Smart guides, equal spacing and grid-true nudges

- **For users:** nodes line up as you drag; you never need Align for a row.
- **Spec:**
  - While dragging a node or selection, show thin accent guides when an edge or centre lines up with a
    node within 600 px (in view). Snap to it within 6 screen px.
  - When the gap to a neighbour equals another gap in that row or column, show the two gaps with a small
    "=" marker and snap to it.
  - Guides beat the grid: object snapping first, then the 10 px grid when nothing is near.
    **Ctrl/Cmd held during a drag turns snapping off**, as in Figma. Alt is taken: Alt-drag duplicates
    (D9).
  - As in tldraw, snapping engages only when the pointer slows down, so a fast drag across the canvas
    isn't sticky.
  - Guides draw on one overlay canvas, only during a drag. They never show in presentation, exports or
    live.
  - Nudging follows the grid when Snap is on: arrow = 10 px, Shift+arrow = 50 px, and Alt+arrow = 1 px
    (nudging always snaps the result to the grid first). With Snap off, 1 px and 10 px as today.
    **[Changes behaviour]**
  - Draw the dot grid every 10 px at zoom 1 or more and every 20 px below, so the dots and the snap agree.
- **Default:** guides on, and part of Snap: Show ▸ Snap to grid becomes **Show ▸ Snapping** (grid and
  guides). **[Vocabulary]**
- **Effort:** M. **Risk:** medium: performance on large diagrams (precompute at drag start; see
  Responsiveness).
- **Rules:** 1 (beautiful by default), 10.

### D7. Text editing: one set of rules

- **For users:** you name things as you make them, and every text box behaves the same.
- **Spec:**
  - **Enter** on a single selected node, boundary or annotation edits its label or text; F2 still works.
    On an edge it edits the label.
  - Typing a printable character on a selected node doesn't start editing. Our single-letter keys (T, L, C)
    would collide, and draw.io's "type to replace" surprises people who meant a shortcut.
  - A node added by quick-add, D1 or D3 opens its label editor with the stencil's name selected. Typing
    replaces it; Enter keeps it. Rail and palette clicks don't (bulk adding stays fast).
  - **Esc commits** in every inline editor, matching annotations, Figma and tldraw. Ctrl+Z right after
    reverts. **[Changes behaviour]** for node labels (today Esc cancels).
  - In the node editor, Tab moves from Label to Subtitle; Enter on Subtitle saves.
  - Inline editors (node, edge label, boundary) never render smaller than their CSS size: scale by
    1/zoom below 100%, as the hover cards do since round 7.
  - Keys typed before a menu or the palette has focus are buffered and replayed into its search (F9).
    Ctrl+K also preloads the palette on the first pointer move over the canvas, not after 3 s.
- **Effort:** S. **Risk:** low.
- **Rules:** 6 (no surprises), 7, 8.

### D8. Edges: reconnect ends, insert on drop

- **For users:** rewire an edge by dragging its end; drop a node onto an edge to put it in between.
- **Spec:**
  - A selected edge shows a small round handle at each end (accent ring, `crosshair` cursor). Dragging one
    to another node moves that end (`onReconnect`), keeping the label, relationship and settings. Dropped
    on empty canvas it snaps back; it doesn't delete the edge.
  - Dragging a single node (or dropping a stencil from the rail) over an edge highlights the edge after
    300 ms of hovering. Dropping then splits it: A→N and N→B. The first keeps the original edge's id, label
    and relationship; the second copies the relationship. Ctrl/Cmd held while dropping skips it.
  - No manual waypoints (see "Not doing"). "Route from side" stays in the menu and inspector for the rare
    edge that needs it.
- **Default:** end handles only on a selected edge; the split only after a deliberate hover.
- **Effort:** M. **Risk:** medium: the split must not fire on a drag that only passes over an edge (the
  hover delay and the highlight guard it).
- **Rules:** 3, 6.

### D9. Duplicate, paste and Alt-drag without overlap

- **For users:** copies land where you can see them, never on top of the original.
- **Spec:**
  - **Ctrl+D**: the copy goes one gap away in the flow direction (`placeNextTo`, the free spot), and stays
    selected. tldraw does this (the width + 10 px to the right, seen hands-on). Ctrl+D again repeats
    the last offset if you moved the copy (Figma's smart duplicate), or keeps stepping.
  - **Ctrl+V**: at the pointer when it's over the canvas; otherwise at the free place nearest the view's
    centre (`placeFree`). **Ctrl+Shift+V** pastes in place (same coordinates). Repeated pastes step by
    one free slot, never by +30 on top of the last.
  - **Alt-drag** a node or selection drags a copy; the original stays. The cursor shows `copy` while
    Alt is held over a selected node.
  - Duplicated and pasted edges between copied nodes come along, as today. "Duplicate with connections"
    (copy the edges into the selection too) is Alt+Shift+arrow's job (D3).
- **Default:** on. **Effort:** S. **Risk:** low. **[Changes behaviour]** (paste position).
- **Rules:** 10 (nothing overlaps).

### D10. Zoom to selection

- **For users:** jump to what you're working on, then back to the whole diagram.
- **Spec:**
  - **Shift+2** fits the selection (or the hovered node with nothing selected), clear of the panels.
  - The palette finds "Zoom to selection". Ctrl+K's node results already centre a node.
  - Double-clicking the minimap centres the view there.
  - Zoom to selection stops at 125% (no huge single nodes).
- **Effort:** S. **Risk:** low. **Rules:** 8, 9.

### D11. Bulk edit in the inspector

- **For users:** change many things at once without hunting for menus.
- **Spec:** the multi-selection panel shows the fields the selected things share:
  - edges: **Relationship** and **Label**;
  - nodes: **Boundary** and **Stencil** (one stencil picker; "Mixed" when they differ);
  - annotations: **Colour**;
  - a mixed selection: only the sections whose kind is present, under a small header each ("3 nodes",
    "2 edges").
  - A mixed value shows "Mixed" and an empty field. Setting it applies to all, as one undo step.
  - Align and Distribute stay at the top; Distribute shows at 3 or more.
  - "Select all like this": a node's and an edge's right-click get **Select similar** (same stencil; same
    relationship). It's also in the palette.
- **Effort:** M. **Risk:** low. **Rules:** 2, 3.

### D12. Boundaries that keep up

- **For users:** a boundary holds its nodes without you fixing its size.
- **Spec:**
  - While dragging nodes, the boundary that will hold them on drop shows its outline in its tone. If they'd
    leave their boundary, it shows dashed. One rule decides: the node's centre.
  - Dropping a member so it pokes out (its centre still inside) grows the boundary to contain it, with the
    usual padding, in the same undo step. Boundaries never shrink by themselves; Fit to contents does that.
  - Adding a node into a boundary (D1, D3 or the rail) grows the boundary if needed.
  - Resizing a boundary adopts nodes now inside it, and releases nodes now outside it. It says so in a
    toast with Undo ("Added 2 nodes to Payments").
  - Fit to contents moves from the right-click into the boundary's inspector panel too (one button).
- **Effort:** M. **Risk:** medium: auto-grow must not cause overlaps with neighbours (if growing would
  overlap another boundary, don't grow; show it dashed instead).
- **Rules:** 1, 10.

### D13. The stencil rail: preview while dragging, and respect the selection

- **For users:** you see what you're placing; the rail does the same as Ctrl+K.
- **Spec:**
  - Dragging a stencil shows a node-card preview at the current zoom (`setDragImage` with an offscreen
    card), and over the canvas a faint outline where it will land (snapped). Over an edge it uses D8's
    split; over a node's handle it connects from that node.
  - A rail click with exactly one node selected adds the stencil after it, connected, as Ctrl+K does. The
    rail's footer says "Adds after Order service" while that's true. **[Changes behaviour]**
- **Effort:** M. **Risk:** low.
- **Rules:** 7, 9.

### D14. Keyboard selection between nodes

- **For users:** move around a diagram without the mouse.
- **Spec** (round 7, P1):
  - The canvas is one Tab stop.
  - Inside it, **Tab / Shift+Tab** step through nodes in reading order (rows, then columns in the flow
    direction).
  - **Ctrl+Alt+arrows** move the selection to the nearest node in that direction.
  - Arrow keys stay nudges.
  - Edges are reached from a node with **Ctrl+Alt+]** (next outgoing edge) and **Ctrl+Alt+[** (incoming).
- **Effort:** M. **Risk:** medium (a11y regressions; screen readers need the node's name and its edges).
- **Rules:** 8.

### D15. Tidy the selection

- **For users:** clean up a messy corner without re-laying out the whole diagram.
- **Spec:**
  - With 3 or more nodes selected, the selection right-click gets **Tidy up**. It runs the layered layout
    on the selected nodes and their edges, inside their current bounding box, keeping its top-left. It also
    goes in the palette and the multi-select inspector beside Align.
  - The canvas's Auto-layout stays for the whole diagram.
- **Effort:** M. **Risk:** low (the layout exists; constraining it to a box is the work). **Rules:** 1.

---

## Build batches

Each batch is one PR, ends with a UX review gate (`docs/DESIGN-REVIEW.md`), and updates the shortcuts sheet,
`docs/UX-PRINCIPLES.md` (vocabulary and the Mouse rows) and the e2e specs (`data-testid` only).

### Batch 1: the basics feel right (highest impact, mostly S)

- D4 navigation (wheel pans, pinch zooms, Space and middle-drag)
- D5 selection gestures (drag selects, Shift+click adds, inspector waits for pointer-up)
- D1 drop on empty to create and connect
- D2 handles you can hit, plus connect feedback
- D9 duplicate, paste and Alt-drag without overlap
- D10 zoom to selection

**Why first:** these are the gestures people use every minute. Each is small on React Flow's existing props
and callbacks, and together they remove the "this isn't like other tools" moments. One release note covers
the two habit changes (D4, D5).

**Gate checks:** trackpad and mouse walk at 1280 and 1440, embeds still scroll the page, live and
presentation still drag-to-pan, and the overlap audit still passes with duplicates and pastes.

### Batch 2: precision (alignment and text)

- D6 smart guides, equal spacing and grid-true nudges (Snap to grid becomes Snapping)
- D7 one set of text-editing rules, type-ahead buffering and palette preload

**Gate checks:** Event Timing for a drag on the Kafka example and a 150-node diagram (the backlog's measurement), at 4×, no worse
than today. No guides in exports, presentation or recordings.

### Batch 3: flow building (keyboard and edges)

- D3 the "+" chip and Alt+arrow quick-add (with Alt+Shift+arrow clone-and-connect)
- D8 reconnect edge ends, and insert a node by dropping it on an edge
- D13 a rail drag preview, and rail clicks that respect the selection

**Gate checks:** build the Kafka example's right half from a blank diagram, keyboard only, and count the
keystrokes. The target is under 60 for 6 nodes and 6 edges with names.

### Batch 4: structure and bulk

- D12 boundaries that keep up
- D11 bulk edit in the inspector, and Select similar
- D15 tidy the selection
- D14 keyboard selection between nodes

**Gate checks:** the chrome count. The multi-select panel must stay within one screen at 1280×800 for a
mixed selection.

---

## Explicitly not doing, and why

- **Hover arrows on every node** (draw.io's four blue arrows). They add four targets to every hover, they
  overlap neighbours and edges in a dense diagram, and they'd be the busiest thing on the canvas. One "+"
  on the selected node (D3) and drop-on-empty (D1) do the same job.
- **Manual waypoints and freehand edge bending.** The router keeps edges off nodes and labels off each
  other. Waypoints would fight it, go stale whenever a node moves, and need a "reset route" control.
  Pinned sides (Route from side) remain for the rare case.
- **Dragging edge labels by hand.** Same reason: label placement is automatic and overlap-free. If a label
  needs to move, the edge's route should change, not the label.
- **Format painter and copy/paste style.** Our styling is semantic (stencil, relationship, colour of a
  boundary or annotation). Bulk edit (D11) and Select similar cover "make these like that" without a mode.
- **Lock.** Nothing overlaps, boundaries drag only by their label, and zones never move nodes. There's
  little to lock away. If accidental moves of a boundary become a complaint, revisit.
- **Z-order shortcuts.** Layering is rare by design (round 2 removed it from the node menu). The selection
  and annotation menus keep Bring to front and Send to back.
- **Type-to-rename on a selected node.** It collides with T, L and C and surprises people (D7).
- **A drawing toolbar or tool modes** (R for rectangle, A for arrow). Nodes come from stencils, and
  annotations from the rail's Annotate row, the right-click and T. A modal toolbar is chrome we don't need.
- **Auto mouse/trackpad detection** for the wheel. It's unreliable across browsers and devices. One clear
  rule (D4) is better.
- **Snapping to edges' midpoints or other exotic snaps.** Node edges, centres and equal gaps are enough.

---

## Open questions for the user

1. **Wheel = pan (D4) and drag = select (D5).** Both match Figma, tldraw, Excalidraw and draw.io, but they
   change today's habits: wheel zooms and drag pans. Ship both together in batch 1, or keep wheel-zoom for
   mouse users behind a View ▸ setting? (Recommendation: ship both, no setting.)
2. **Esc in node label editing (D7).** Esc commits everywhere, like annotations and Figma, or Esc cancels
   everywhere, like today's node editor and draw.io? (Recommendation: commit, with Ctrl+Z to revert.)
3. **New nodes open their label editor (D7)** after quick-add, D1 and D3, but not after a rail or
   palette click. Is that the right split, or should every new node start in rename?
4. **The rail respects the selection (D13).** Should a rail click with one node selected add the stencil
   after it, connected, like Ctrl+K? Or should the rail always add an unconnected node, with Ctrl+K as the
   connected path?
5. **Boundaries auto-grow (D12).** Is growing on drop what you want, or should a boundary only ever change
   size by hand and with Fit to contents?

---

## Sources

- **draw.io:** [shortcuts](https://www.drawio.com/docs/reference/shortcuts/),
  [shortcuts.svg](https://app.diagrams.net/shortcuts.svg),
  [modifier shortcuts](https://www.drawio.com/docs/reference/shortcuts/modifier-shortcuts-in-diagrams/),
  [clone and connect](https://www.drawio.com/docs/reference/shortcuts/shortcut-clone-connect/),
  [copy on connect](https://www.drawio.com/doc/faq/copy-on-connect),
  [connectors](https://drawio.com/doc/faq/connectors),
  [alignment tools](https://www.drawio.com/docs/manual/editor/alignment-tools/),
  [layouts](https://www.drawio.com/doc/faq/apply-layouts),
  [style shortcuts](https://drawio.com/blog/shortcut-styles).
- **Excalidraw** (GitHub source):
  [HelpDialog.tsx](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/components/HelpDialog.tsx),
  [snapping.ts](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/snapping.ts),
  [actionDuplicateSelection.tsx](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/actions/actionDuplicateSelection.tsx),
  [constants.ts](https://github.com/excalidraw/excalidraw/blob/master/packages/common/src/constants.ts).
- **tldraw:** [snapping](https://tldraw.dev/sdk-features/snapping),
  [user preferences](https://tldraw.dev/sdk-features/user-preferences),
  [note shape](https://tldraw.dev/sdk-features/note-shape),
  [v3.13 elbow arrows](https://tldraw.dev/releases/v3.13.0),
  [actions.tsx](https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/ui/context/actions.tsx),
  [Brushing.ts](https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/tools/SelectTool/childStates/Brushing.ts),
  [Translating.ts](https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/tools/SelectTool/childStates/Translating.ts).
- **Figma / FigJam:**
  [alignment and position](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions),
  [copy, paste, duplicate](https://help.figma.com/hc/en-us/articles/4409078832791),
  [copy and paste properties](https://help.figma.com/hc/en-us/articles/4412765442967-Copy-and-paste-properties-between-layers),
  [quick actions](https://help.figma.com/hc/en-us/articles/23570416033943-Use-quick-actions),
  [FigJam connectors](https://help.figma.com/hc/en-us/articles/1500004414542),
  [FigJam quick create](https://help.figma.com/hc/en-us/articles/1500004414382).
- **Lucidchart:** [lines and the shape auto-prompt](https://help.lucid.co/hc/en-us/articles/16157138194836),
  [shapes, format painter, nudge](https://help.lucid.co/hc/en-us/articles/16390096079764),
  [keyboard navigation](https://help.lucid.co/hc/en-us/articles/30939569926164),
  [shortcuts](https://lucid.co/blog/lucidchart-shortcuts).
- **Miro:** [shortcuts](https://miro.com/shortcuts/).
- **Whimsical:** [shortcuts](https://whimsical.com/learn/shortcuts/pc),
  [flowcharts](https://whimsical.com/learn/get-started/flowcharts).
- **Eraser:** [quickstart](https://docs.eraser.io/quickstart.md),
  [draggable edits](https://docs.eraser.io/draggable-edits-beta.md).
