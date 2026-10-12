# Design review

## Round 13: brand verification and the name Live Diagrams (2026-10-12)

The OAuth providers' reviewers need the home page, without sign-in, to show the app's name exactly as on the
consent screen, say what it does and link the privacy policy. Google rejected "LiveDiagrams" against a site that
said "Diagrams", so the product is now **Live Diagrams** everywhere it's named. The common noun ("Your
diagrams"), identifiers, the format and the providers' **Apps › Diagrams** folder are unchanged.

- **No new chrome.** The start card gains one muted footer line: "**Live Diagrams** is a free, open-source
  diagram tool that runs in your browser", with **Privacy** and **Terms** beside it. Both open in a new tab, as
  the shortcuts sheet's Privacy link does, so the open diagram stays. The top bar is unchanged apart from the
  longer wordmark. At 1024 × 768 it still fits with no overflow, and the card clears the canvas controls; the
  footer wraps its links to a second line (`tests/e2e/brand.spec.ts`).
- **Before the app starts.** `index.html` carries a quiet start-up page with the mark, the name, one line and
  the two links, in the theme's colours. It shows while the script loads, and in place of the app without
  JavaScript. React replaces it on mount, and embeds hide it (`theme.js` marks `?embed`). It's a loading state,
  not a page, so it adds no layout jump to the app.
- **Checked:** start card light and dark at 1024 and 1440, and the page without JavaScript
  (`tests/.output/verify-shots/`).

## Round 12: Private diagrams (design note before building, 2026-10-12)

The owner, verbatim: "What can we do in order to make things private, or is there any concern there. I'm
thinking for example, if I want to have diagrams for work. I know the diagrams themselves are part of the URL."
Approved plan: a **Private diagram** switch that turns the existing local-only protection (until now only for
the built-in, development-only private examples) into a setting for any diagram.

**The honest answer first.** Nothing is uploaded today: diagrams live in this browser, and a share link carries
the diagram in its `#` fragment, which browsers never send to a server. The exposure is the link itself (chat
history, synced browser history, whoever gets it), cloud saves, and AI agents reading the page. Private closes
those three doors for one diagram; it can't stop the person exporting a file, the browser's own extensions
reading the page, or someone with access to the device.

**One decision, one word.** `src/lib/localOnly.ts` stays the single privacy decision. `privacyOf()` answers
`"local-only"` (a built-in private example, a copy of one, or in development content matching one; always
private, no switch), `"private"` (the person's switch, or inherited) or `null`. Every gate asks it:
`isLocalOnly` (AI), `canShareAsLink` (every link, so password-protected links compose through the same gate),
`canSaveToCloud` and `canUseOnDevice`. The user-facing word is **Private** everywhere (menus, badge, panel,
dialog, library, docs); "local-only" stays an internal name for the built-in ones, whose behaviour and copy are
unchanged.

**Where the switch lives (fewest clear places).**

- **File ▸ Privacy ▸** (one new File-menu row, so the menu stays at 12 with cloud storage): **Private diagram**
  (checked when on) and **New diagrams are private** (one remembered setting, off by default), with a note:
  "Export a file to share a private diagram." The row's line reads "This diagram is private" while it is.
- **The lock badge** beside the title on the diagram card ("Private"). Clicking it opens the **Private diagram**
  dialog: what's off (links, cloud, AI), a link to the privacy page, and **Keep private** (the default) or
  **Make not private**. That dialog is the one confirmation for turning it off, wherever that starts.
- **Ctrl+K**: "Make this diagram private" / "Make this diagram not private…".
- **Your diagrams** marks private rows ("Private · 4 nodes · edited…"), no new button. The inspector stays as it is.

Making an example or a shared diagram private saves a private copy in Your diagrams (they aren't yours to change).

**What Private does.**

- **Links:** Copy share link and Embed code… stay in the File menu, off, saying "Private diagrams can't be shared
  as links. Export a file instead."; the canvas right-click's Export ▸ shows them off with "Private"; any other
  way in (a shortcut, a stale menu) gets that sentence as a toast with **Export file**. The page's
  `get_share_link` refuses too. If the address bar still holds a `#` fragment when a diagram becomes private,
  it's cleared.
- **Cloud:** Save to ▸ Google Drive / OneDrive / Dropbox are off ("Off for private diagrams"); Ctrl+S on a
  diagram bound to a cloud file says so and offers **Save to this device**. Files on this device (Save, Save as,
  Export) are the person's own act and stay.
- **AI:** the page's WebMCP tools unregister; Copy for AI is off ("Private"); Advanced's boxes stay, off, with
  "Off for this private diagram."; agent turns can't happen. The panel says **AI is off for this private diagram**
  ("Agents, Copy for AI and copied prompts can't read it.") and, where Chrome's model can run, offers **Allow the
  on-device model (stays on this device)**, per diagram, off by default. Allowed, the box comes back; its
  dictation listens only with on-device speech (otherwise it says why and doesn't start), since the browser's
  speech service would send audio away.
- **Provenance:** Duplicate, Save a copy, a private copy and an export → import round trip stay private. A file
  says `"private": true` (`public/schema/diagram.v1.json`, the skill's format page and `llms.txt` know it; the
  skill's `share-link.mjs` refuses such a file), and the library keeps the flag in the entry, never in the stored
  document. Copying nodes from a private diagram marks the clipboard (in-app and the system clipboard's JSON), and
  pasting them makes the target private, with a toast saying so; an example or a shared diagram refuses the
  paste instead. "New diagrams are private" covers what's started, opened from this device, imported or pasted
  (a file opened from cloud storage keeps saving back there).
- **The privacy page** (`public/privacy.html`) gains "Private diagrams" with the limits above.

**Out of scope:** encryption at rest (the browser's storage isn't ours to encrypt meaningfully without a
password the person must keep), and private flags for examples.

## Round 11: structure and bulk (batch 4) (2026-10-12)

Batch 4, the last of `docs/research/drawing-ux.md`: D12 boundaries that keep up, D11 bulk edit in the inspector
and Select similar, D15 tidy the selection, and D14 keyboard selection between nodes. Decision 5 applies: a
boundary grows on drop to hold a node dropped into it and never shrinks by itself; Fit to contents stays (the
right-click and the boundary's inspector both have it). The three habit changes (boundaries, Tab, Route ▸) are in
`docs/RELEASE-NOTES.md`.

**What changed**

- **Membership you can see (D12).** One rule, as before: a node belongs to the boundary around its centre (the
  inner one, when boundaries nest). While nodes are dragged, the boundary that will hold them on drop shows a solid
  outline in its tone and a stronger tint (`boundary-join-1440-light`, `boundary-hold-1440-light`); one they'd
  leave shows a dashed outline (`boundary-leave-1280-dark`). Solid against dashed, so it never rests on colour
  alone. It's painted on the boundaries' elements once a frame, so a drag re-renders nothing.
- **Growth on drop (D12).** A member dropped so it pokes out (its centre still inside) grows its boundary to hold
  it with the usual 40 px padding, on the sides it pokes out of only, onto the grid, in the drop's undo step
  (`boundary-grown-1440-light`). It never grows onto another boundary or onto a node that isn't its own: then the
  drag shows it dashed and it stays as it is (`boundary-blocked-1440-dark`: Order service poking out of AKS
  towards Commerce gateway). A node added inside a boundary (quick-add, a dropped connection, Alt+arrow, the rail,
  Insert node, a paste or a duplicate) grows it the same way.
- **Leaving is explicit (D12).** Today's complaint was a node near the edge silently dropping out. Now the
  boundary shows dashed during the drag, and on drop a toast says so with Undo: "Payments service left AKS ·
  commerce workloads + Kafka" (`boundary-left-toast-1280-dark`). Several at once: "3 nodes left Payments".
- **Resizing adopts and releases (D12).** Resizing a boundary takes in the nodes whose centre is now inside it and
  lets go of members now outside, with a toast and Undo ("Added 1 node to Shipping"), in the resize's undo step.
- **Bulk edit (D11).** The multi-selection's inspector leads with **Arrange** (the six Align buttons; at three or
  more, Distribute and **Tidy up**), then one compact section per kind present, headed by its count: **3 nodes**
  (Stencil, Boundary, and a collapsed Simulation with the settings their roles share), **2 edges** (Relationship,
  Label), **1 annotation** and **1 boundary** (Colour), then Add boundary and Delete (`bulk-mixed-1280-light`).
  Where values differ the field reads **Mixed**: the stencil button, a disabled "Mixed" option in a select, an
  empty field with a "Mixed" placeholder, and "Mixed" under the swatches' label with none ticked
  (`bulk-nodes-stencil-1440-dark`). Every change is one undo step: each click gets its own tag, and typing in a
  shared field coalesces as typing in one field does.
- **Select similar (D11).** On a node's and an edge's right-click, and in Ctrl+K: every node of that stencil, or
  every edge of that relationship (Message, Request, or that one dependency; hidden dependencies stay out)
  (`select-similar-menu-1440-light`, `select-similar-done-1440-light`).
- **Tidy up (D15).** On the selection's right-click (three or more nodes), the inspector's Arrange and Ctrl+K. The
  layered layout runs on just the selected nodes and the edges between them. Its layers close up to fit the
  selection's box where an 80 px gap along the flow and 40 px across it allow (a gap a named edge crosses keeps
  its label's room), and its top-left stays. Nothing else moves; if the result would cover anything (cards,
  notes, shapes), the tidied nodes move together to the nearest free place. Members stay in their boundaries,
  which grow to hold them. One undo step (`tidy-before-1440-light`, `tidy-menu-1440-light`,
  `tidy-after-1440-light`).
- **Align and Distribute never stack.** Aligning the tops of a column used to put every card on the same spot;
  now what would land on another steps along the line, 40 px apart. Distributing more than fits the span does the
  same.
- **Keyboard selection (D14).** The canvas is one Tab stop: only the node last focused (else the first in reading
  order) is in the page's Tab order, and edges are out of it. Inside, Tab and Shift+Tab step through nodes in
  reading order (rows from the top, each left to right; columns in a top-to-bottom diagram), meeting each boundary
  just before its first member; past the last node Tab leaves the canvas, so it's never a trap.
  **Ctrl+Alt+arrows** go to the nearest node that way (within 45° of the arrow, distance across it counting
  double; else the nearest on that side), and **Ctrl+Alt+]** and **[** to the node's outgoing and incoming edges,
  again for the next (`keyboard-nav-1440-dark`, `keyboard-edge-1440-dark`). Selection and focus move together, the
  view pans if it must, and a polite live region says what's selected: "Payments service, Go Service, processor,
  in AKS · commerce workloads + Kafka. 7 of 16. 2 out, 1 in." for a node, "Payments service to Payment ledger,
  request: Record authorization. Outgoing 1 of 2." for an edge, "Nothing above." at an edge of the diagram.
- **Menus within budget.** Select similar takes the node menu to 12 rows. The edge menu was already at 12, so Route
  from side and Route to side fold into one **Route ▸** row (From side ▸, To side ▸, each showing its current side)
  (`edge-menu-route-1280-dark`). Tidy up takes the selection menu to at most 12. The palette names the folded leaves
  in full ("Route from side › Top").
- **Docs.** The shortcuts sheet has five Selection rows (Tab, Shift+Tab, Ctrl+Alt+arrows, Ctrl+Alt+], Ctrl+Alt+[)
  and two Mouse rows (dragging across a boundary's edge, a boundary's corner) (`shortcuts-selection-1280-light`).
  `docs/UX-PRINCIPLES.md` has Membership, Bulk edit, Select similar, Tidy up and Moving between nodes in the
  vocabulary, and the same two Mouse rows.

**Chrome count**

| Surface                             | Before                                         | After                                                     | Budget   |
| ----------------------------------- | ---------------------------------------------- | --------------------------------------------------------- | -------- |
| Node right-click (edit)             | 11                                             | **12** (Select similar)                                   | ≤ 12     |
| Edge right-click (edit, a flow)     | 12                                             | **12** (Select similar in, Route from/to folded to Route) | ≤ 12     |
| Selection right-click               | up to 11                                       | **up to 12** (Tidy up, three or more nodes)               | ≤ 12     |
| Canvas right-click                  | 9                                              | 9                                                         | ≤ 12     |
| Multi-selection inspector, 1280×800 | count, Align, Distribute, Add boundary, Delete | Arrange + one section per kind; fits with room to spare   | 1 screen |
| Top bar, rails, floating bars       | unchanged                                      | unchanged                                                 |          |

The gate: a mixed selection (three nodes, two edges, a note and a boundary) at 1280×800 shows every section with
the inspector's body not scrolling, its last button above the window's bottom (`structure-bulk.spec.ts`, "fits one
screen"); in `bulk-mixed-1280-light` (three nodes, two edges and the AKS boundary) the panel ends with 180 px to
spare.

**What I checked** (dev server and the production build, public Kafka example, 1280×800 and 1440×900, light and
dark): every shot above; the e2e suite on the production build; the drag in live view (no outline: the watch runs
only while editing); presentation and embeds (no roving tab stops in embeds, which stay as they were); the AI panel's
turns (applyDiagram is untouched); relationships (Select similar keeps hidden dependencies out, bulk Relationship
uses the same one-step `applyChoice` as the right-click); batches 1–3 (their specs pass unchanged, apart from the
edge menu's Route row).

**Findings, fixed in this batch**

1. **A member poking out on one side grew its boundary on every side.** Inventory service dragged to poke out of
   AKS's right edge sat 40 px below its top, closer than the padding and label row, so the top grew too, onto
   Schema registry, and the growth was refused (the drag showed dashed for a move that only needed 50 px on the
   right). Now only the sides it pokes out of move.
2. **Tidy up let its own members go.** The tidied row was wider than its boundary, so the members' centres landed
   outside and the centre rule took them out. Tidy up rearranges members; it keeps them in, and the boundary grows.
3. **Tidy up squashed named edges.** Closing the gaps to fit the box took a labelled gap down to the 80 px minimum,
   where round 10 saw labels truncate. A gap a named edge crosses now keeps the room the layered layout gave it.
4. **Closing up across the flow could overlap layers.** The layered layout centres short layers, so a per-row
   squeeze moved slots of different layers into each other. Across the flow everything now draws together by one
   factor, never closer than 40 px within a layer.
5. **Tab trapped focus.** Stepping in reading order with every node still a Tab stop meant Tab past the last node
   landed on another node, and so on forever. The roving tab stop (one node in the page's order) fixes it.
6. **Boundaries in the middle of Tab's order.** By their centres, a boundary came after the first row of its own
   members. Tab now meets it just before its first member.

**Deviations from the plan**

- **A toast when a member leaves.** D12 has the dashed outline; the batch's brief asked that leaving be explicit,
  and a drop that ends with the card still half over the boundary isn't. The toast carries Undo, and only leaving
  says so (joining is visible).
- **Blocked growth keeps the member.** D12 says not to grow onto another boundary and to show it dashed; the node
  stays a member (its centre decides), poking out. A neighbouring node that isn't a member blocks growth too.
- **Tidy up keeps members in their boundary** (finding 2) and moves the whole result to the nearest free place
  rather than refusing when it doesn't fit; Align and Distribute gained the no-stacking rule.
- **Ctrl means the Control key** for Ctrl+Alt+arrows and brackets, on a Mac too (⌃⌥): ⌘⌥+arrows switch the
  browser's tabs there. With VoiceOver on, ⌃⌥ is its own key; VoiceOver users have its navigation.
- **From an edge,** Ctrl+Alt+] cycles the edges leaving its source, Ctrl+Alt+[ those arriving at its target,
  Tab carries on from its source, and an arrow goes from its middle.
- **Mixed edges** show the Relationship and Label only; the edge's simulation fields stay per edge.

**Left for later**

- **Undo forgets the selection.** History restores the selection each step was saved with, so after undoing a bulk
  change the multi-selection is gone and the panel with it. Keeping the current selection across undo is a
  history-wide change for its own batch.
- Nudging a member out with the arrow keys doesn't change membership (only a drop does).
- Guides while resizing a boundary (from round 9).

### Round 11 follow-up: the review of PR #45

The Codex review (`.reviews/20261012-072522`, 7 P1, 10 P2). Each was reproduced before fixing; none rejected.
Several shared a root cause and were fixed once:

| #         | Finding                                                                         | Verdict   | What changed                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Validate simultaneous growth against the resulting boundaries (P1)              | Confirmed | `settleMembership` plans all growth at once: proposals in id order, each checked against the others as they will be (accepted growth included). The drag's preview and the drop use the same plan. Unit tests: the review's two layouts, and the same plan whatever order the nodes come in.                                                                                        |
| 2, 3      | Tidy commits positions its boundaries can't hold (P1 ×2)                        | Confirmed | Tidy plans positions and boundaries together (`planKeep`): a candidate place is accepted only if each member's boundary can grow to hold it without reaching another boundary or a non-member, and each node's centre then sits in its own boundary (or in none). The planned positions and growth commit as one step, or nothing does.                                             |
| 4, 6      | Tidy's search scans every obstacle per candidate; its work is unbounded (P1 ×2) | Confirmed | One search, `findClearTranslation` in `placement.ts`: the obstacles within its reach indexed once on a grid in flat arrays (no allocation per test), each candidate's boxes translated once, and a work budget (400,000 box tests, 200 `accept` calls). The review's 200 + 600 node case takes 5 ms (it took 14 s). `perfBudget` tests in placement and tidy.                       |
| 5         | Overlap spreading is cubic when aligning a row (P1)                             | Confirmed | `spreadOverlaps` is one pass: each box, in order, jumps past the furthest earlier box in its band if it overlaps one. 1,000 boxes aligned onto one spot: 6 ms (505 ms before). A test under `perfBudget`.                                                                                                                                                                           |
| 7, 10, 12 | An exhausted search commits an overlapping layout (P1, P2 ×2)                   | Confirmed | A search that runs out returns null: Tidy keeps every node where it was and says "Couldn't find room. Nothing moved." Unit tests with the review's layouts and an e2e test. A selected shape or note, which stays put, now counts as an obstacle too.                                                                                                                               |
| 8         | Share the guaranteed fallback with placement (P2)                               | Confirmed | `findFree` (and so `placeFree` and `clearOffset`) and Tidy share `findClearTranslation`. Copies keep their guaranteed `pastAll` fallback; Tidy treats failure as failure.                                                                                                                                                                                                           |
| 9         | Simultaneous growth, the correctness view (P2)                                  | Confirmed | As 1.                                                                                                                                                                                                                                                                                                                                                                               |
| 11        | The preview copies growing buckets every frame (P2)                             | Confirmed | Buckets are made once per call and appended to. 5,000 members of one boundary: 4 ms a frame (21 ms before).                                                                                                                                                                                                                                                                         |
| 13        | Colour edits tested with one item of each kind (P2)                             | Confirmed | New e2e: two notes (yellow, blue) and two boundaries (azure, AWS), Mixed for both, every item set, one undo per edit restoring every original value.                                                                                                                                                                                                                                |
| 14        | Tidy's undo doesn't check boundaries (P2)                                       | Confirmed | The Tidy e2e checks every member's boundary after Tidy, and that one Undo restores every node and boundary exactly.                                                                                                                                                                                                                                                                 |
| 15        | Mixed drags skip membership for unrelated nodes (P2)                            | Confirmed | Only the members a dragged boundary carries are left alone; every other dragged node (its copy, for an Alt-drag) is previewed and settled. While a boundary moves, the preview reads boundaries each frame. New e2e.                                                                                                                                                                |
| 16        | Boundary-only diagrams have no keyboard entry (P2)                              | Confirmed | The roving Tab stop is the first thing in Tab's order, boundaries included, and Ctrl+Alt+arrows with nothing selected start there too. New e2e.                                                                                                                                                                                                                                     |
| 17        | Descendant buttons stay in the Tab order (P2)                                   | Confirmed | A node's dependency pips and an edge's settings label are `tabindex="-1"` (inline editors keep focus while open). Their list opens while the node or edge has keyboard focus, and the announcement reads it ("Dependencies: Config · orders-config", "4 settings · 2 secret"). New e2e: Tab through a diagram with dependencies hidden stops only on nodes, then leaves the canvas. |

## Round 10: flow building (batch 3) (2026-10-12)

Batch 3 of `docs/research/drawing-ux.md`: D3 the "+" and Alt+arrow quick-add with Alt+Shift+arrow
clone-and-connect, D8 reconnecting an edge's end and inserting a node by dropping it on an edge, and D13 the
stencil rail's drag preview and selection-aware clicks. Decision 3 applies (nodes made by Alt+arrow and the "+"
open their name; rail and palette clicks don't), and decision 4 (a rail click with exactly one node selected
adds after it, connected). The one habit change, the rail click, is in `docs/RELEASE-NOTES.md`.

**What changed**

- **The "+" (D3).** A single selected node shows one "+" chip, 20 px on screen at any zoom, 16 px off its
  downstream side (right, or below in a top-to-bottom diagram). Never on hover, never on two selected nodes,
  never in live view, presentation, embeds or exports. When a neighbour or an edge label is on that side it
  moves to the first free side (below, above, then upstream); in a dense diagram where all four are taken it
  sits on the card's own top-right corner. A click opens quick-add for the next node; a drag from it is a connect
  gesture, like any handle (it is one), so a drop on empty canvas opens quick-add there and a drop on a node
  connects.
- **Alt+arrow (D3).** With one node selected (or a shape, which takes edges), Alt+→ and Alt+↓ open quick-add for
  a node downstream that way, Alt+← and Alt+↑ for one upstream (it connects into the selected node). Quick-add
  opens beside a faint outline of where the node will land (left of it when growing left, so it never covers
  the node), and the view pans first if it must, to show the node, the outline and the menu. The pick arrives
  there, connected, with its name selected for typing; keys typed meanwhile are kept. Alt+arrow never nudges,
  and on the canvas it never goes back or forward in the browser.
- **Alt+Shift+arrow (D3).** Skips the menu: a copy of the node (stencil, name, subtitle, settings) lands there,
  connected the same way, its name selected.
- **Where the next node lands.** One gap that way: 160 px along the flow (room for the connection's label, as in
  the examples) and 80 px across it. A fan-out steps into a column (or a row), and the spot is then checked
  against every node, note, shape and drawn edge with the copy margin, as batch 1's copies are, so it never
  lands on anything. Ctrl+K's "Add … after" and a rail click after a selected node use the same placement.
- **Naming the connection.** A node just made connected (a dropped connection's quick-add, Alt+arrow, the "+"
  and Alt+Shift+arrow) opens its editor with a third field, the connection's label, one Tab after the
  subtitle. Naming the node and its connection joins the add's undo step, so one Ctrl+Z takes the lot.
- **Reconnect (D8).** A selected edge shows a round end on each side (accent ring, 12 px on screen, a 24 px hit
  area). From the keyboard: the edge's menu (and Ctrl+K) **Reconnect ▸ From / To**, a searchable list of nodes. Dragging
  one draws a dashed line from the end that stays, lights up the node a drop would move it to (anywhere on it),
  and keeps the crosshair; `not-allowed` over a text, note, zone or the other end's node. Dropped on a node, that
  end moves there and the edge keeps its id, label, relationship, kind and settings (the side pinned for that
  end belonged to the old node, so it's cleared). Dropped anywhere else, or Esc, it snaps back. One undo step.
- **Insert on drop (D8).** A single node with no edges of its own, held over an edge for 300 ms, lights the
  edge's line up; dropped there, the edge splits into A→N and N→B. A→N keeps the edge's id, label and source
  side; both keep its kind, relationship and settings (each its own copy); N→B takes the target side. That's
  the AI's `insert_between`, with the id kept. Passing over an edge, or dropping with Ctrl/⌘ held, never splits;
  the drag and the split are one undo step.
- **The rail (D13).** Dragging a stencil shows the node card it makes, at the canvas's zoom
  (`setDragImage`), not the browser's picture of the row. Over empty canvas a faint outline shows where it will
  land (snapped); over a node, the node lights up and the drop goes after it, connected; held over an edge, the
  edge lights up and the drop goes in between. A rail click (or Enter in its search) with exactly one node
  selected adds after it, connected, and the footer says so: "A click adds after **Payments service**,
  connected. Drag to place it anywhere." In live view the rail keeps adding a node by itself.
- **Quick-add search** ranks stencils the way the rail's search does, aliases included: "pg" finds PostgreSQL,
  "go" the Go service, "nod" Node.js. It used to list matches in catalogue order ("go" found Google Pub/Sub
  first).
- **Docs.** The shortcuts sheet has Alt+arrow and Alt+Shift+arrow under Edit, and three Mouse rows (the "+", a
  selected edge's end, holding a node on an edge). `docs/UX-PRINCIPLES.md` has Quick-add, The next node,
  Reconnect and Insert in the vocabulary, the connection field under Editing text, three Mouse rows and rule
  10's "one gap beside it".

**The gate: the right half of the Kafka example, keyboard only, in 58 keys** (target: under 60)

From a bare URL (a blank diagram), with nothing clicked: orders.created.v1 feeding Inventory, Payments and
Notification services, each writing to its store. That's the topic plus six nodes and six named edges, all
of the example's stencils and names. Every key counts, searches included; the names themselves are content,
the same in any tool, so they aren't counted:

| Step                                      | Keys                                                                             | Count               |
| ----------------------------------------- | -------------------------------------------------------------------------------- | ------------------- |
| Inventory database (PostgreSQL)           | Ctrl+K `p` `g` Enter · Enter “Inventory database” Enter                          | 6                   |
| Inventory service (Java), upstream        | Alt+← `j` `a` `v` Enter “Inventory service” Tab Tab “Reserve SKUs” Enter         | 8                   |
| orders.created.v1 (Kafka topic), upstream | Alt+← `k` `a` `f` Enter “orders.created.v1” Tab Tab “Reserve inventory” Enter    | 8                   |
| Payments service (Go), from the topic     | Alt+→ `g` `o` Enter “Payments service” Tab Tab “Authorize payment” Enter         | 7                   |
| Payment ledger (PostgreSQL)               | Alt+→ `p` `g` Enter “Payment ledger” Tab Tab “Record authorization” Enter        | 7                   |
| Back to the topic                         | Ctrl+K `o` `r` `d` Enter                                                         | 5                   |
| Notification service (Node.js)            | Alt+→ `n` `o` `d` Enter “Notification service” Tab Tab “Send confirmation” Enter | 8                   |
| Notification dedupe (Redis Cache)         | Alt+→ `r` `e` `d` ↓ Enter “Notification dedupe” Tab Tab “SET NX · dedupe” Enter  | 9                   |
| **Total**                                 |                                                                                  | **58** (+ 13 names) |

Building upstream first (store, service, topic) leaves the topic selected for its fan-out, so only one trip
back to it is needed. The fan-out lands as a column, the stores beside their services, nothing overlapping
(`gate-result-1440-light`). The sequence is a test (`tests/e2e/flow-building.spec.ts`, "gate"), which fails
at 60 keys or more. Before this batch each connected node from the keyboard was Ctrl+K "Add … after" (13 keys
for "kafka topic", F1), the fan-out needed a trip back per branch, and an edge couldn't be named from the
keyboard at all.

**What I checked** (production build, public Kafka example, 1280×800 and 1440×900, light and dark):

- **The "+".** On Payments service at the fitted 1280 view, every side has a neighbour or a label, so the chip
  sits on the card's corner (`plus-chip-1280-light`); on Order operations, with room on its right, it's 16 px
  off the card (`plus-chip-side-1440-dark`).
- **Alt+arrow.** Alt+↓ on Order operations at the bottom of the view: the view pans up, the outline shows below
  the node and quick-add opens beside it, covering neither (`alt-arrow-quick-add-1440-light`). Alt+↓ on
  Notification service, "pg", then Tab, Tab into the connection's field (`new-node-connection-1280-dark`).
  Alt+Shift+↑ on Inventory service (`clone-and-connect-1440-dark`).
- **Edges.** The ends of a selected edge (`edge-ends-1280-light`); dragging one onto Commerce metrics, lit up,
  with the dashed line from the end that stays (`reconnect-drag-1440-light`). A new Redis cache held over the
  "Commit order + outbox" edge (`insert-on-edge-1280-dark`) and dropped (`insert-on-edge-done-1280-dark`).
- **The rail.** The footer with Payments service selected (`rail-after-footer-1440-light`); a stencil dragged
  over empty canvas, its outline and (placed by hand, since a headless browser can't capture a drag image) the
  card it drags (`rail-drag-outline-1440-dark`).
- **The sheet.** Edit rows (`shortcuts-flow-1280-dark`) and Mouse rows (`shortcuts-mouse-1440-light`).
- **Live, presentation, embeds and exports.** No "+", no edge ends and no Alt+arrow in live view (tested); the
  chip is a handle, which image exports already leave out, and the edge ends, the outline and the insert line
  are left out by class. The AI panel's turns, relationships (an edge into Key Vault added by Alt+arrow is
  still inferred as a dependency) and batch 1 and 2 (drop to create, copies, guides, editing keys) pass their
  specs unchanged.
- **Responsiveness.** Selecting renders the "+" for the selected node only; other nodes' selector is a constant.
  The stencil rail doesn't re-render on select, drag or undo (its footer follows the selection by itself:
  `perf.spec.ts` checks it). The insert check runs only while a single unconnected node is dragged, against the
  routes as drawn when the drag began (no layout reads per move).

**Findings, fixed in this batch**

1. **The "+" hid under edge labels in a dense diagram.** Labels draw above nodes, and at the fitted Kafka view
   every side of Payments service has a neighbour or a label. Now, with no free side, the chip sits on the card's
   own corner, where nothing else ever is. It is placed again whenever edges change (an insert moves labels).
2. **Quick-add covered the node it grew from** near the bottom of the view (it was clamped up over the outline
   and the node). It now opens beside the outline, and the view pans first when the node, the outline and the
   menu don't fit.
3. **The edge to insert into lit up away from the node.** Edges route around nodes, so the moment a node covers
   an edge, the edge steps aside, and the highlight (and the hit test) followed the detour. The hit test now
   uses the routes as they were when the drag began, and the line it will split is drawn lit through the node.
4. **Quick-add closed itself after fast naming.** The new node's reveal pans a moment later, and any viewport
   move closed menus. Moves the app makes no longer close menus; a pan by hand still does.
5. **The first key after a quick-add pick could be lost.** Between the type-ahead handing over and the editor
   mounting, a key reached the canvas. The editor now mounts in the same task.
6. **Ctrl+K "Add …" left focus on the page,** so Enter didn't name the new node and Alt+arrow didn't grow from
   it. The new node takes focus once drawn.
7. **The rail re-rendered on every selection** (its new footer was a prop). The footer now follows the
   selection by itself (`perf.spec.ts`).
8. **Named edges between hand-added nodes truncated their labels** ("Reserv…") at the 80 px gap Ctrl+K used.
   Nodes added beside a node now leave 160 px along the flow, as the examples do.
9. **Two Edit rows wrapped in the sheet**; their labels are shorter. The connection field's hint says what it
   is ("The connection's label · Enter saves").

**Deviations from the plan**

- **The connection's label in the new node's editor.** D7 has Tab go from label to subtitle; a node just made
  connected gets a third field. Without it an edge can't be named from the keyboard until D14 (batch 4), and
  the gate asks for named edges.
- **Insert only for a node with no edges of its own.** Moving an already wired node and pausing over a line
  shouldn't rewire the diagram. New nodes and rail stencils (the common case) insert as specified.
- **A stencil dropped anywhere on a node goes after it**, not only on its handle (D13): as D2 made a drop
  anywhere on a node connect.
- **A stencil dropped on empty canvas that lands on something moves to the nearest free place** (batch 1's
  rule for copies), so the outline shows the drop spot and a crowded drop steps clear.
- **Alt+Shift+arrow copies only the node**, connected to it the same way as Alt+arrow. "Duplicate with
  connections" (the copy taking the original's other edges) isn't in; a copy beside its original reads as a
  fan-out from it.
- **Quick-add's search ranking** and the **wider gap** are new here (findings 8 and the gate); AI placement and
  live view's entry points keep their 80 px gap.

**Left for later batches**

- D14 keyboard selection between nodes (Tab, Ctrl+Alt+arrows, edges by Ctrl+Alt+[ ]): the gate's one trip back
  to the topic goes through Ctrl+K's node search today.
- Quick-add ranking "downstream" stencils after the recents (from round 8).
- Boundaries that grow to take a node added next to a member (D12): a copy placed above a boundary's top row
  lands outside it.

### Round 10 follow-up: CI and the review of PR #44

**CI** failed on all three retries of `drawing-basics.spec.ts:269` (drop to create, then one undo takes the node
and its edge). The trace showed Undo restoring "Kafka Topic": the add and the name were two undo steps. History
records a step once edits pause for 350 ms, and the add was only joined by its name when the name came sooner.
Batch 3 adds work as the new node appears (the "+" mounts and measures on it, the editor has three fields),
and on the CI runner the name came 554 ms after the add. That was the real fault: one step had only ever been
luck. Now every connected node is made by one editor command, tagged for undo, and its name (and its
connection's label) carries the same tag, so they are one step whatever the timing (within the history's
1.5 s merge window, after which a late name is its own step). A test names a node 800 ms after the add.

**The review** (`.reviews/20261012-051950`, 6 P1, 8 P2), each checked first:

| #   | Finding                                                                                                  | Verdict             | What changed                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1-4 | Connected nodes read React Flow state not yet committed (architecture, correctness, security, types; P1) | Confirmed (one bug) | A unit test with React-like queued setters gave "flow" for Key Vault. `createConnected` builds the node and edge from one snapshot, inferring the relationship from both stencils; drop to create, the "+", Alt+arrow, Alt+Shift+arrow, the rail and Ctrl+K after a selection, and a stencil dropped on a node all use it. `insertNode` does the same for an insert. |
| 5   | Reconnect has no keyboard entry point (P1)                                                               | Confirmed           | Edge menu and Ctrl+K: **Reconnect ▸ From / To**, a searchable node list. One submenu, so the flow edge's menu stays at 12 items.                                                                                                                                                                                                                                     |
| 6   | Insert on edge is drag-only (P1)                                                                         | Confirmed           | Edge menu and Ctrl+K: **Insert node ▸** (stencil search); the node lands in free space near the middle and its name opens, as quick-add's does.                                                                                                                                                                                                                      |
| 7   | The "+" has low contrast on some stencils (P2)                                                           | Confirmed           | The chip uses the app's accent, not the stencil's: 5.9:1 (light) and about 7:1 (dark) on the surface; hover inverts with the accent's own ink.                                                                                                                                                                                                                       |
| 8   | Reconnect ends are a 12 px target (P2)                                                                   | Confirmed           | A 24 px hit area around the 12 px dot, at any zoom.                                                                                                                                                                                                                                                                                                                  |
| 9   | The split duplicates `insert_between` (P2)                                                               | Confirmed           | One rule, `src/model/edgeSplit.ts` over `DiagramEdge`; the AI op and the canvas adapter call it, and a contract test checks both give the same two edges (only the ids differ, by design).                                                                                                                                                                           |
| 10  | Every selected node rescans the selection (P2)                                                           | Confirmed           | The single selected node is worked out once per store change and shared.                                                                                                                                                                                                                                                                                             |
| 11  | The "+" doesn't re-place on zoom (P2)                                                                    | Confirmed           | It re-places (and re-measures as a handle) when the zoom moves a step.                                                                                                                                                                                                                                                                                               |
| 12  | The Esc test never pressed Esc (P2)                                                                      | Confirmed           | New test: Esc over a lit node, then release: nothing changes, no undo step, the line and highlight go.                                                                                                                                                                                                                                                               |
| 13  | Drag measured before the view settled (P2)                                                               | Confirmed           | Measured after the reveal's pan; the test also checks the node moved and the edges didn't.                                                                                                                                                                                                                                                                           |
| 14  | The gate test didn't check topology (P2)                                                                 | Confirmed           | It checks all six (from, to, label) triples and every node's stencil from the saved diagram.                                                                                                                                                                                                                                                                         |

Also found while repeating the gate test: after saving a name, the editor handed focus back to the node a frame
later, even when a key pressed meanwhile had opened Alt+arrow's quick-add, so the search lost its keys. Focus now
goes back only if nothing else took it.

None rejected. The palette names each Reconnect leaf in full ("Reconnect to › Billing") through a new
`paletteLabel` on menu items, since "Reconnect › Billing" would be ambiguous.

## Round 9: drawing precision (batch 2) (2026-10-12)

Batch 2 of `docs/research/drawing-ux.md`: D6 smart guides, equal spacing and grid-true nudges, and D7 one set
of text-editing rules, type-ahead and a preloaded palette. Decision 2 applies: Esc saves a node's label, and
Ctrl/⌘+Z takes it back. Decision 3 (from batch 1) is unchanged: only quick-add, drop-on-empty and, later,
Alt+arrow open a new node's label editor. Both habit changes (Esc, and the nudge steps) are in
`docs/RELEASE-NOTES.md`.

**What changed**

- **Smart guides (D6).** While a node or a selection is dragged, its left edge, centre and right edge (and
  top, middle and bottom) line up with the nodes, notes, texts and shapes in view, within 6 px on screen and
  600 px across. One thin accent line per axis shows it: the centre when it lines up (same-size cards share
  all three), else the edge that does. Boundaries and zones never guide (they're backdrops), but they snap
  when you drag them, and a boundary's members move by exactly the same amount.
- **Equal spacing (D6).** The drag also snaps to the gap of its row or column: centred between its two
  neighbours, or one gap past a pair. The two gaps show as short ticked lines, each with a small "=". When an
  alignment and an equal gap agree, both show.
- **Snapping (D6).** Guides first, then the 10 px grid. Ctrl/⌘ held during a drag places freely (Alt stays
  Alt-drag's). Guides engage once the pointer slows below about 1000 px/s, and catch up 90 ms after a fast
  drag stops, so flinging a node across the canvas isn't sticky. Show ▸ Snap to grid is now **Show ▸
  Snapping** (grid and guides). Undo takes a drag back in one step, as before.
- **Grid-true nudges (D6).** With Snapping on, an arrow key moves the selection's corner to the next 10 px
  grid line, and Shift+arrow 50 px onto the grid; with it off, 1 px and 10 px as before. The dots are drawn
  every 10 px from 100% zoom and every 20 px below, so the dots and the snap agree where they can be told
  apart.
- **Guides only while editing.** The guide layer exists only while editing and draws only during a drag. It
  isn't rendered in presentation, live view or embeds, so recordings (always presentation view) can't show
  it, and it sits outside the viewport an image export renders. A drag in live view snaps to the grid alone.
- **One set of editing keys (D7).** Every inline editor (a node's label and subtitle, an edge's label, a
  boundary's name, a text, note, shape or zone) follows the same rules, kept in one place (`editKeys.ts`):
  Enter saves (a text or note adds a line; Ctrl/⌘+Enter saves), Tab goes from Label to Subtitle and saves
  after the last field, Shift+Tab goes back, and Esc saves. A save from the keyboard puts focus back on the
  thing edited, so Enter edits it again and Ctrl/⌘+Z undoes the edit. An edit that changed nothing writes
  nothing.
- **Enter edits (D7).** Enter on a single selected node, edge, boundary or annotation opens its editor (F2
  still works). On a focused node that isn't selected, Enter selects it first, as before. In live view Enter
  keeps its meaning there (continue after a note). Typing a letter never starts editing: T, L and C stay
  shortcuts.
- **Readable editors (D7).** Below 100% zoom every inline editor scales up by 1/zoom, so it reads at least at
  its CSS size: the node editor is 260 px wide with 13 px text on screen at any zoom (its text was 6 px at the
  fitted zoom). An edge label's field is 12 px while typing. Zoomed out, the node editor is wider than its
  card, so it moves left to stay inside the canvas (never under the inspector) and opens above the card near
  the bottom. A text, note or shape keeps its line breaks and gets a plain surface while it's magnified.
- **Type-ahead and the palette (D7).** Keys typed after Ctrl+K but before its search exists go into the
  search: "Ctrl+K kafka topic" typed fast searches "kafka topic" instead of making a Text reading "o". An Enter
  among them runs the best match, and an Esc closes. Quick-add's search keeps early keys the same way. The
  palette's code now loads on the first pointer move or Ctrl/⌘ press, not after 3 s, and once loaded it opens
  in the same frame as the key.
- **Docs.** The shortcuts sheet has an **Editing text** section (Enter, Ctrl/⌘+Enter, Tab, Esc), Mouse rows
  for dragging a node and for Ctrl/⌘ while dragging, Enter beside F2, and the new nudge steps.
  `docs/UX-PRINCIPLES.md` has Snapping and Editing text in the vocabulary, the Esc line, and two Mouse rows.

**What I checked** (production build, public Kafka example, 1280×800 and 1440×900, light and dark):

- **Guides.** Dragging Commerce metrics up into the payment events row, under Notification service: a line
  along the row and one down the column, and both ways the gaps match their neighbours', so four "=" gaps
  show (`guides-align-1280-light`). That's the busiest a drag gets, on a diagram laid out on a grid; most
  moves show one line. Dragging Order operations up its column: the line along the row and the two equal
  gaps above it (`guides-equal-gaps-1440-dark`).
- **Editors at the fitted zoom.** Enter on Order service (`node-editor-fitted-1280-light`); Tab into the
  subtitle of Payment ledger at the right edge, where the editor moves left to stay clear of the inspector
  (`node-editor-at-edge-1440-light`); the HTTPS edge's label (`edge-editor-fitted-1440-dark`); the AKS boundary's name
  (`boundary-editor-fitted-1280-dark`).
- **Palette.** Ctrl+K and "kafka topic" typed at 25 ms a key straight after (`palette-typeahead-1280-light`).
- **Menus and sheet.** Show ▸ Snapping (`show-snapping-1440-light`); the sheet's Editing text section and
  Mouse rows (`shortcuts-text-1280-dark`).
- **Responsiveness** (the batch's gate). `scripts/perf/drag-latency.mjs` drags a node along a fixed path at
  about 60 moves a second, slowing at the end, on a production (e2e) build at 1440×900: Order service on the
  Kafka example, and n75 on the Lab's generated 150-node diagram. Event Timing (16 ms threshold), frame gaps
  and long animation frames, 16 runs each, alternating master and this branch in one session:

  | Drag                   | Worst event p50 / p90 / max (ms) | Frames p50 / p90 / max (ms) | Longest LoAF p50 / p90 (ms) |
  | ---------------------- | -------------------------------- | --------------------------- | --------------------------- |
  | Kafka, 4×, master      | 32 / 40 / 40                     | 17 / 17 / 33                | 51 / 58                     |
  | Kafka, 4×, this branch | 32 / 32 / 48                     | 17 / 17 / 33                | 0 / 54                      |
  | 150 nodes, 4×, master  | 56 / 64 / 64                     | 17 / 50 / 83                | 93 / 102                    |
  | 150 nodes, 4×, branch  | 56 / 64 / 64                     | 17 / 33 / 83                | 91 / 103                    |
  | Kafka, 1×, both        | 16 / 24 / 24                     | 17 / 17 / 17                | 0 / 0                       |
  | 150 nodes, 1×, master  | 16 / 24 / 32                     | 17 / 17 / 17                | 0 / 0                       |
  | 150 nodes, 1×, branch  | 24 / 32 / 32                     | 17 / 17 / 17                | 0 / 0                       |

  At 4× (the gate) it's no worse, and the 150-node drag drops fewer frames (p90 33 against 50 ms): a move
  that snaps to where the node already is now costs nothing. At 1× the 150-node drag's worst event is one
  8 ms bucket higher (pointer-out events early in the drag), still under two frames. In both builds the worst
  events are the press and the drop, not the moves.

**Findings, fixed in this batch**

1. **The first guides cost a frame on large diagrams.** Measuring found four costs, all removed:
   - React Flow's grid snapping skipped moves that didn't change the snapped spot; the new snapping passed
     every move on. A move that lands where the node already is now changes nothing.
   - The guides drew on a pane-sized canvas (the plan's suggestion): about 8 ms a redraw at 4× on 150 nodes.
     They're now one thin SVG path per line, in a 1 px layer that draws outside itself; a pane-sized layer
     over the moving nodes cost a few ms a frame even when empty.
   - Switching React Flow's grid snapping off and on with `setState` woke every node's and edge's store
     subscription twice a drag. It's switched in place now: React Flow reads it on each move, and nothing
     subscribes to it.
   - The equal-spacing index found every box's neighbours when a drag started (quadratic). It now finds the
     one or two it needs, on first use.
2. **Three guide lines per axis read as clutter** when same-size cards line up (top, middle and bottom at
   once). Now there's one line per axis.
3. **Esc in live view hid the next hover's breakdown.** Saving with Esc puts focus back on the node, and in
   live view a focused node's breakdown beat a hovered one's. Now whichever moved last wins.
4. **The magnified node editor ran under the inspector** for a node near the canvas's right edge. It now moves
   left to stay inside the canvas, and opens above its card near the bottom.
5. **The shortcuts sheet started 270 px down a 1280×800 window and ran off its bottom** (already in round 8's
   shots; the Editing text section made it worse). Its height was capped by a grid row that grew to the
   sheet's whole content. It's capped by the window now, and the body scrolls (`shortcuts-text-1280-dark`).

**Deviations from the plan**

- **No Alt+arrow 1 px nudge.** D6 lists it, but D3 (batch 3) gives Alt+arrow to "add the next node that way".
  Fine steps are Snapping off (1 px, Shift 10 px) or a Ctrl/⌘ drag.
- **An SVG layer, not a canvas,** for the guides: measured above.
- **Texts, notes, shapes and zones** read at their CSS size too while edited (D7 names the node, edge and
  boundary editors only): every editor is readable.

**Left for later batches**

- Guides while resizing (an annotation's or a boundary's edge lining up), and in the stencil rail's drag (D13,
  batch 3).
- Quick-add's ranking of "downstream" stencils (from round 8).

## Round 8: drawing basics (batch 1) (2026-10-12)

Batch 1 of `docs/research/drawing-ux.md`: D4 navigation, D5 selection gestures, D1 drop to create, D2
hittable handles with connect feedback, D9 copies that never overlap, D10 zoom to selection. Decision 1
applies: wheel-pans and drag-selects ship together, with no setting. The habit change is announced in
`docs/RELEASE-NOTES.md`; the app has no "what's new" surface, and this batch didn't add one.

**What changed**

- **Navigation (D4).** In the editor, live view and presentation, the wheel and a two-finger swipe pan on
  both axes (Shift+wheel sideways), and Ctrl/⌘+wheel and pinch zoom at the pointer. Space+drag and the middle
  button pan, even when the drag starts on a node; Space shows `grab`, then `grabbing`. Embeds keep their
  rule: the wheel scrolls the host page, and pinch or Ctrl+wheel zooms.
- **Selection (D5).** While editing, a drag on empty canvas draws the selection box. It picks what it
  touches, or with Ctrl/⌘ held only what's wholly inside. Boundaries and zones are picked only when wholly
  inside, so a box drawn among a boundary's nodes doesn't pick the boundary. Edges come along only when
  both ends are picked. Shift+click toggles, like Ctrl/⌘+click. Below 1680 px the inspector waits for the
  pointer-up. Live view, presentation and embeds keep drag-to-pan. The empty canvas shows the arrow
  cursor, not React Flow's hand.
- **Drop to create (D1).** A connection dropped on empty canvas opens quick-add at the drop point.
  Recently used stencils come first: at most three, so the menu stays within budget, and search shows each
  stencil once. The pick lands centred on the drop, connected, and opens its label editor with the name
  selected (decision 3). The whole thing is one undo step. Esc or a click away adds nothing. Over empty
  canvas the dashed line ends in a "+".
- **Handles and connect feedback (D2).** On a hovered or selected node, each handle has a hit area of at
  least 20 px on screen at any zoom, sitting just outside the card. A press inside the card near its edge
  still moves the node, and the area never takes clicks meant for an edge next to an unhovered node. A drop
  anywhere on a card connects to it, and the side follows the geometry, as for every floating edge. The
  card a drop would connect to wears the selection outline. The cursor stays `crosshair` throughout the
  drag (`not-allowed` over a text, note or zone).
- **Copies (D9).**
  - **Ctrl+D** puts the copy one gap beside the original. It tries downstream first, then across the flow,
    then the other two sides, and takes the nearest free place if all four are taken. Ctrl+D again on the
    copy repeats the step, or repeats the gap you chose by moving the copy.
  - **Ctrl+V** centres the paste on the pointer over the canvas, or on the view's centre when the pointer
    is elsewhere.
  - **Alt+drag** drags copies away and leaves the originals (the cursor is `copy` while Alt is held over a
    selected node).
  - Every copy lands clear of the other nodes, notes and shapes, and of edges. New copies, pastes and
    dropped nodes are panned into view, clear of the inspector and of floating chrome such as the minimap.
- **Zoom to selection (D10).** Shift+2 fits the selection, or the hovered node when nothing is selected,
  at no more than 125% and clear of the panels. It's also in Ctrl+K and in the shortcuts sheet.
- **Docs.**
  - The shortcuts sheet's Mouse section was rewritten, and "Drag: pan the canvas" was added under Live and
    presenting.
  - `docs/UX-PRINCIPLES.md` gained vocabulary for Quick-add, the selection box, pan and zoom, Duplicate,
    Paste and connecting, plus a Mouse and trackpad table.
  - No onboarding hint mentioned drag-to-pan or wheel-zoom, so none changed.

**What I checked** (production build, public Kafka example, 1280×800 and 1440×900, light and dark):

- **Trackpad-style wheel.** Six small wheel steps of (4, 12) panned exactly −24 / −72 px at an unchanged
  zoom, and Ctrl+wheel zoomed at the pointer (0.49 → 0.52 at 1280). A mouse wheel notch pans 100 px.
- **Connecting.** Dragging from Order operations to empty canvas showed the "+"
  (`connect-empty-plus-1280-light`). Quick-add opened at the drop (`quick-add-at-drop-1280-light`), and the
  pick arrived connected with its editor open (`new-node-naming-1280-light`). Dropping on Schema registry's
  body lit it up and connected (`connect-target-lit-1440-dark`).
- **Selection box.** Mid-drag, six nodes and the edges between them were picked while the inspector stayed
  folded (`box-select-mid-drag-1440-light`). On release it opened (`box-select-done-1440-dark`).
- **Copies and zoom.**
  - Two Ctrl+Ds on Payments service, in a column with no free side, landed clear and in view
    (`duplicate-twice-1280-dark`).
  - A paste aimed at Order service stepped clear of it (`paste-on-node-steps-clear-1440-light`).
  - Shift+2 on Inventory database: `zoom-to-selection-1440-light`.
  - The sheet: `shortcuts-mouse-1280-dark`, `shortcuts-mouse-1440-light`.
- **The overlap audit.** `tests/e2e/layout.spec.ts` passes over every example. The new specs check the
  bounding boxes of every node after Ctrl+D ×2, Ctrl+V ×3 (one aimed at a node) and an Alt-drag dropped
  onto a node.
- **Responsiveness.** Dev build, Kafka example, 1280, Event Timing with a 16 ms threshold and five runs
  each, alternating with master in the same session:
  - **Node drag at 4×:** the worst pointer event was 120–160 ms here against 136–144 ms on master, with the
    same frame percentiles (p50 17 / p90 50 ms). No pointer move reached 16 ms in either.
  - **Box select:** the press is now under 16 ms and the release 24–40 ms (master's Shift+drag, 24–32 ms).
    A frame where the picked set changes costs up to about 50 ms at 4× (p90), because the box picks what it
    touches and re-renders the selection as it changes; moves that don't change it cost nothing extra.
  - Two costs were found in the walk and fixed. First, opening the inspector moved from the press to the
    release, which made the release 208 ms; it now waits for the next frame. Second, a state flag
    re-rendered the canvas on every press; it's a ref now.

**Findings, fixed in this batch**

1. **A node made from a drop near the right edge landed under the inspector it opened, and its label
   editor with it.** Keep-in-view skipped it because it wasn't measured yet. Fixed: new copies, pastes and
   dropped nodes are revealed once measured.
2. **A dropped node near the bottom sat under the minimap,** because keep-in-view ignores floating chrome.
   Fixed: a second, minimal pan clears the overlays, leaving room for the label editor below the card
   (`panClearOf`, unit-tested).
3. **Ctrl+D in a dense column jumped two rows into the next column,** where the copy read like a downstream
   node. That came from stepping `placeNextTo` across the flow. Fixed: the four sides are tried in order,
   then the nearest free place.
4. **The Mouse rows wrapped to three lines** in the sheet at 1440. Fixed: shorter rows, one idea each.

**Left for later batches**

- **Text editing (D7).** The inline editor's text is still tiny at the fitted zoom (visible in
  `new-node-naming-*`). A fast typist's first key after Enter in quick-add can still reach the canvas while
  the card is being measured (F9).
- **Quick-add ranking (D1).** It doesn't yet rank "downstream" stencils after the recents.

## Round 7: UX gate after relationships, Ask AI, slow motion and examples (2026-10-11)

Reviewed against `docs/UX-PRINCIPLES.md` after the biggest batch so far: relationship kinds (dotted
dependencies, Show ▸ Dependencies, Relationship ▸, pips, settings), edge-label pills above particles,
storage providers, Ask AI (Build with AI, the docked panel, turns with Undo / Revert, Change with AI…,
live Simulate / Explain, dictation, Ctrl+I, WebMCP), slow motion and calmer speeds below 1×, the inline
editor drawn on top, and 15 examples with a themed picker and a start card.

Walked on the dev server (port 5501) in Chrome, at 1024×768, 1280×800 and 1440×900, light and dark,
public examples only. Interactions were driven with the Chrome DevTools MCP and scripted Playwright
walks: real right-clicks, hovers and key presses. Overlap was measured with `getBoundingClientRect`,
sampled every 250 ms through a whole slow-motion replay. Menu hovers were traced in Chrome's performance
panel and timed with the Event Timing API, with and without 4× CPU throttling. The flows:

1. **First visit:** the start card, All examples, three examples opened from it (AKS, Kafka,
   Event-driven data platform) and the picker.
2. **Editing:** add, connect and rename inline. Right-click the canvas, a node, an edge (Relationship ▸)
   and a selection, then Esc out.
3. **Relationships:** the AKS example. Settings on hover, Show ▸ Dependencies off (pips), the inspector's
   settings editor, and presentation.
4. **Ask AI:** open and closed. A thread of three pasted replies, hovering a turn, Revert to here,
   Connect a model, Build with AI from the start card and Change with AI… on a selection.
5. **Live:** play, pause and speed, 0.25×, trace, slow motion, then Ask AI with a trace open.
6. **Keyboard only:** Tab order, Esc layering, Ctrl+K, ? and the menus' keys.

Screenshots: `docs/screenshots/round7/`. Findings cite `before-*` and `after-*`. The walk-through shots:

- start: `start-all-examples-1280-dark`, `picker-1440-light`;
- editing and relationships: `aks-relationships-1280-dark`, `edge-relationship-menu-1280-dark`,
  `selection-menu-1280-light`, `shortcuts-1280-dark`;
- Ask AI: `change-with-ai-1280-light`, `ai-turn-hover-1280-dark`;
- live: `live-default-1280-dark`, `live-more-1280-dark`, `live-canvas-menu-1280-dark`, `live-slow-1280-dark`;
- presentation: `present-aks-1280-light`.

Mid-review the lead changed Ask AI's direction: model keys go away, WebMCP browser agents become the main
path, and copy and paste moves behind "Advanced". That rework is happening in `src/ai/` in parallel, so
this round changes nothing there. Its Ask AI findings are proposals (A1–A5 below).

### What's great

- **Relationships read at a glance.** Dotted, glyph-marked dependencies next to solid and dashed flows make
  the AKS example explain itself. Relationship ▸ is one clean submenu: Message and Request first with
  "async" and "sync" as hints, then the six dependencies with a check on the current one. Show ▸
  Dependencies is one remembered setting in both places.
- **Slow motion is the best way yet to explain a system.** "Slow motion · live paused" says what's going
  on, the captions name each hop, and Esc goes back to live exactly where it left off. 0.25× draws a calm
  sample, and the counts stay exact.
- **The start card is a real front door.** Four featured examples with thumbnails, "All examples" grouped
  by theme in place, and a picker grouped the same way.
- **Ask AI turns are honest.** "+1 node, +1 connection", hovering a turn outlines what it touched, Revert to
  here is itself a turn you can undo, and an unsure stencil offers its alternatives as chips.
- **App, not page.** No browser menu anywhere, the menus are keyboard-complete, presentation hides Ask AI,
  and Esc backs out of presentation, then live view.
- **Menus are quick.** A trace of hovering the canvas menu in real Chrome showed no slow interactions.
  Submenus open after the menu's 110 ms hover delay. Under 4× CPU throttling the first open of Add node here
  takes about 250 ms; after that, about 65 ms.

### Scorecard

Scores are out of 5. "Before" is the app at the start of this round (round 5 ended at 4–4.5).

| Principle                       | Before | After | Why                                                                                                                                                                    |
| ------------------------------- | :----: | :---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Beautiful by default         |   4    |  4.5  | Hover cards shrank to 5 px text; the dependency list wrapped a word per line. With Ask AI open at 1440, Kafka was fitted at 32%.                                       |
| 2. Progressive disclosure       |   4    |  4.5  | Settings, pips and Relationship ▸ stay one step away. The start card's fourth button is now a link.                                                                    |
| 3. Context over chrome          |  4.5   |  4.5  | Unchanged. Change with AI… and Relationship ▸ act on the thing itself.                                                                                                 |
| 4. One primary action / surface |   4    |   4   | Unchanged. The start card still has no single primary action (examples are the point).                                                                                 |
| 5. Budget the chrome            |  3.5   |   4   | The canvas menu was at its 12 cap, with three rows that repeat the canvas controls. The top bar stays at 8 (A1).                                                       |
| 6. No dead ends                 |  4.5   |  4.5  | Unchanged. Revert to here is a turn you can undo; Clear conversation is undoable.                                                                                      |
| 7. Consistent names             |   4    |  4.5  | "Save to device…", and "Depends on · depends on".                                                                                                                      |
| 8. App, not page                |  3.5   |  4.5  | Esc didn't clear a clicked node. Tab order is still edges before nodes (proposal P1).                                                                                  |
| 9. Teach in place               |  4.5   |  4.5  | Unchanged. The settings card says what a lock means; the panel says how to connect a model.                                                                            |
| 10. Nothing overlaps            |  2.5   |  4.5  | Toasts over the Ask AI panel and the minimap, the trace card over the hop being visited, the start card on the controls, and half a live diagram past the pane's edge. |
| 11. Presentation first-class    |   4    |  4.5  | Dependencies faded to 35% on stage. Ask AI stays out of presentation.                                                                                                  |

### Chrome count

| Surface                          | Before                                                                                         | After                                  | Budget |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------- | ------ |
| Top bar                          | 8 (tabs, picker, Ask AI, View, File, Present, theme; as counted in round 6)                    | 8                                      | ~7     |
| Right edge                       | Inspector rail (52 px) and Ask AI rail (40 px), side by side                                   | Same                                   |        |
| Canvas right-click, edit         | 12: Undo, Redo and Keyboard shortcuts repeat the canvas controls                               | **9**                                  | ≤ 12   |
| Canvas right-click, live         | 10                                                                                             | **9**                                  | ≤ 12   |
| Node / edge / selection (edit)   | 11 / 8 / 10                                                                                    | Same                                   | ≤ 12   |
| Live node / live ⋯               | 9 / 6 rows                                                                                     | Same                                   | ≤ 12   |
| File / View / Show ▸ / Export ▸  | 10 / 8 / 6 / 8                                                                                 | Same                                   | ≤ 12   |
| Start card actions               | 4 buttons over 2 rows at every width                                                           | **3 on one row** ("paste text" inline) |        |
| Ways into Ask AI                 | 7: top bar, rail, Ctrl+I, canvas right-click, Ctrl+K, Change with AI…, Build with AI           | Same (A1 proposes 6)                   |        |
| Surfaces open at once (live, AI) | Up to 8: stencils, inspector rail, Ask AI, trace card, side panel, narration, event log, toast | Same                                   |        |

Net: 4 menu rows removed (3 in edit, 1 in live) and 1 start-card button moved inline. Nothing added.

### Findings

**P1: confusing, broken or overlapping (all fixed)**

1. **Esc never cleared a clicked node's selection.** "Esc backs out one level: … selection" didn't work
   for the most common case: click a node, press Esc. The canvas cleared the selection first, then React
   Flow's own Esc handler on the focused node saw it unselected and selected it again. The canvas now
   clears after React Flow's handler (`src/editor/useCanvasShortcuts.ts`).
   - Test: `round7-polish.spec.ts` › Esc clears the selection.
2. **Toasts covered the Ask AI panel, the inspector rail and the minimap.** The toast was centred on the
   window. With the dock open, the window's centre is near the canvas's right edge.
   - At 1024 the AI toast sat over the panel's reply box
     (`before-ai-toast-over-panel-1024-light.png`).
   - At 1280 and 1440 it sat on the minimap (`before-ai-toast-minimap-1280-dark.png`,
     `before-ai-reverted-1440-dark.png`).
   - Toasts now centre on the canvas pane (`data-toast-area`) and stay inside it. The minimap joins the
     bars a toast stacks above (`data-toast-avoid`). See `after-ai-toast-*.png`.
   - Test: `round7-polish.spec.ts` › a toast stays in the canvas pane, at 1024 and 1440.
3. **In slow motion the trace card hid the hop being visited.** On Kafka at 1280, the Schema registry card
   was fully under the trace card while the card's current row read "→ Schema registry"
   (`before-slowmo-card-1280-dark.png`). The camera's fallback centred a fan-out that couldn't sit beside
   the card. At 1024 the camera didn't follow at all, because a fit that left nodes under the card still
   counted as a fit. Now (`src/live/slowmo/camera.ts`):
   - a fit that leaves path nodes under the card switches to following;
   - while following, the camera keeps the node at work and the next targets clear of the card first, then
     the whole frontier.
   - At 1280 and 1440, sampled every 250 ms, the current hop is never under the card. At 1024, one fan-out
     (three copies leaving Order service at once) still lands a target under the card while the dots
     travel (proposal P4). See `after-slowmo-card-1280-dark.png`.
   - Tests: unit tests in `camera.test.ts`, and `round7-polish.spec.ts` › slow motion keeps the hop at
     work out from under the trace card.
4. **Opening Ask AI in live view left half the diagram past the pane's edge.** With a trace open at 1280, 8
   of Kafka's 15 nodes ended up beyond the canvas's right edge (`before-live-trace-askai-1280-dark.png`).
   The editor's dock refit doesn't apply in live view, whose fits keep clear of the trace card. Live view
   now refits itself when the dock opens, closes or is resized (`after-live-trace-askai-1280-dark.png`).
   - Test: `round7-polish.spec.ts` › live view with a trace refits when Ask AI opens.
5. **Settings and dependency hover cards were unreadable.** They're drawn inside the diagram, so they
   shrank with the zoom. At the AKS example's fit at 1440, the 11 px settings text was about 5 px on
   screen (`before-settings-card-1440-light.png`). Worse, the dependency list (Show ▸ Dependencies off,
   hover the pips) put every word on its own line, "orders-" above "config". Its text sat in the 14 px icon
   column of a two-column grid (`before-pips-card-1440-light.png`). Now:
   - both cards scale by 1/zoom, so they're never smaller than their CSS size;
   - the dependency list is one line per dependency with its glyph, and it opens under the pips instead of
     over the node's own title (`after-settings-card-1440-light.png`, `after-pips-card-1440-light.png`).
   - A readable card can reach over a neighbouring pill while it is open (it closes when the pointer leaves).
     The gap-bridge under it stays unscaled, so a card never covers its own pill.
   - Test: `round7-polish.spec.ts` › hover cards read at their size.

**P2: clutter or inconsistency (fixed: cheap and clear)**

6. **The canvas right-click repeated the canvas controls.** Undo, Redo and Keyboard shortcuts each have an
   always-visible button and a shortcut. Rule 5 already keeps Fit view out of menus for that reason. They're
   `paletteOnly` now, so Ctrl+K still finds them. The canvas menu goes from 12 to 9 rows, and live from 10
   to 9 (`before-canvas-menu-1280-dark.png`, `after-canvas-menu-1280-dark.png`).
7. **Ask AI left the diagram at a third of its size.** At 1440 the stencils (248 px), the inspector rail and
   the dock left Kafka 780 px, fitted at 32%. Below 1680 px an open dock now folds the stencils to their
   rail, as live view does, until you open them by hand. At 1440 Kafka goes from 32% to 41%. At 1280
   (`before-askai-kafka-1280-dark.png`, stencils opened earlier) it was 25%; now it is 34%.
   - Test: `round7-polish.spec.ts` › below 1680px Ask AI folds the stencils.
8. **"Save to device…"** broke the Storage vocabulary ("This device", mid-sentence "this device"). It now
   reads **Save to this device…**.
9. **The start card's four actions wrapped onto two rows at every width,** leaving "Paste text…" alone on
   the second row (`before-first-run-1280-dark.png`). Paste text is now a link in the note ("You can also
   drop a file anywhere, or paste text"). Build with AI steps aside while Ask AI is open, because the panel
   itself says "Build with AI" (`after-start-card-1440-light.png`).
10. **At 1024 with Ask AI open, the start card touched the canvas controls** and overlapped them by 2 px
    (`before-build-with-ai-1024-dark.png`). The card now keeps 64 px each side on a narrow pane
    (`after-build-with-ai-1024-light.png`).
    - Test: `round7-polish.spec.ts` › the start card keeps one row of actions.
11. **Dependencies all but vanished in presentation.** In live view they recede to 35% so the particles lead.
    On a projector their labels ("4 settings · 2 secret", "runs as") were unreadable, though the AKS
    example's description points at them (`before-present-live-1280-light.png`). While presenting they're
    65%: still the quieter line (`after-present-live-1280-light.png`).

**P3: polish (fixed)**

12. A plain setting in the inspector's list showed a closed (grey) lock, the same picture as a secret. It's an
    open lock now (`lock-open`, documented in `docs/ICONS.md`).
13. The Depends on glyph's tooltip and accessible name read "Depends on · depends on". It's "Depends on" now.
14. React Flow's zoom buttons had no `data-testid`. They're tagged `zoom-in-button` and `zoom-out-button`.

**Ask AI proposals (the panel is being reworked in parallel)**

- **A1. One way to show Ask AI at the right edge, not two.** The top bar's Ask AI button and the rail's
  spark do the same thing, and the right edge carries two rails side by side (the inspector's 52 px and
  Ask AI's 40 px; `before-first-run-1280-dark.png`). Merge them into one rail with two buttons (Inspector,
  Ask AI), or drop the top-bar button now that the rail keeps AI in sight. Either way the top bar returns to
  its budget of 7.
- **A2. No toast for a turn the panel already shows.** With the dock open, an applied change shows both the
  toast ("AI: +1 node, +1 connection · Undo") and the turn ("+1 node, +1 connection · Undo this change"):
  two Undos for one change (`before-ai-toast-minimap-1280-dark.png`). Toast only when the panel is folded,
  for example when a WebMCP agent edits.
- **A3. Stale chips on reverted turns.** After Revert to here, an earlier turn's stencil choices stay as
  dimmed chips under "This node changed or was removed". Drop the chips and keep the one line.
- **A4. The placeholder names a node the diagram doesn't have.** "e.g. Add a dead-letter queue after
  billing-worker" on Kafka. Use one of the diagram's own node names, or a generic example.
- **A5. Nested landmarks.** The dock is a `region` "Ask AI" inside another `region` "Ask AI". Keep one.

### Simplify before adding

| What                                      | Do                                                                                                                                                  | Why                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Canvas right-click Undo, Redo, ? sheet    | **Removed** (done): Ctrl+K only                                                                                                                     | Always-visible controls and shortcuts (rule 5)           |
| Start card "Paste text…" button           | **Moved** into the note as a link (done)                                                                                                            | Four buttons wrapped onto two rows                       |
| Start card Build with AI with Ask AI open | **Hidden** while the dock is open (done)                                                                                                            | The panel says the same thing                            |
| Top-bar Ask AI and the Ask AI rail        | **Merge** (A1): one rail, two buttons, or no top-bar button                                                                                         | Two rails, and a top bar over budget                     |
| AI toast with the dock open               | **Remove** (A2)                                                                                                                                     | The turn shows the change and its Undo                   |
| Live node menu's two trace rows           | **Merge** "Trace next message from here" and "Watch one message in slow motion from here" into **Trace from here ▸** (Next message, In slow motion) | Two long rows that differ by one idea                    |
| Inspector settings: text box and list     | **Merge** into one list with inline add and edit, and the lock as the toggle                                                                        | The same four keys are listed twice, one above the other |
| Minimap                                   | **Default off** below 1440 px or with Ask AI open                                                                                                   | 168×112 px of a 560–780 px pane, and a toast obstacle    |

### Proposals for the lead to schedule

- **P1. Tab order: nodes before edges.** From the top bar, Tab reaches the stencil toggle, then all 15 of
  Kafka's edges, then the nodes; the Live toggle and canvas controls come after every node. Make the canvas
  one tab stop with arrow keys between nodes (and Alt+arrows along edges), or at least put nodes first.
- **P2. Live view's first-run hint, toast and live bar all want the bottom centre.** They stack correctly
  now, but three layers there is busy. Retire the hint once someone has gone live (it already does) _and_
  once they've right-clicked once.
- **P3. The inspector doesn't refit when a selection opens it below 1680 px.** Selecting a node on the
  right of a wide diagram keeps it in view, but the rest is cut off at the inspector's edge. Consider the
  dock's rule: refit a fitted view whenever a side panel changes the pane.
- **P4. Slow motion at 1024 with a fan-out.** The camera doesn't pan while dots travel, so with three copies
  leaving at once one target can still sit under the trace card. Either let the card show only its header
  and current hop while slow motion follows on a narrow pane, or allow one gentle pan as a fan-out starts.
- **P5. "React Flow" attribution** floats over nodes when the camera zooms in (slow motion). Move it under
  the canvas controls, or into the shortcuts sheet's footer if the license allows.
- **P6. Palette noise.** Ctrl+K "slow" in the editor lists "Change stencil › Snowflake" and nine more
  stencils. When nothing matches as a word, say "Slow motion is in live view (L)" rather than fuzzy stencils.

### What changed, in numbers

- **Removed:** Undo, Redo and Keyboard shortcuts from the canvas right-click (edit 12 → 9, live 10 → 9);
  the start card's Paste text button (now an inline link); Build with AI on the start card while the dock
  is open.
- **Renamed:** Save to device… → **Save to this device…**; the Depends on tooltip loses its echo.
- **Moved:** toasts from the window's centre to the canvas pane's; the dependency list from over the node to
  under its pips.
- **Better defaults (no new controls):**
  - Esc clears a clicked node;
  - hover cards are readable at any zoom;
  - the slow-motion camera keeps the hop at work clear of the trace card;
  - live view refits around the dock;
  - Ask AI folds the stencils below 1680 px;
  - dependencies read in presentation;
  - plain settings show an open lock.

## Round 6: Ask AI everywhere (design note before building, 2026-10-11)

The owner, verbatim: "I don't know that there's AI available, not unless I want to build something new",
then: "it should be an always visible on the side thing so that you can be in any diagram and always ask
quick to change things around [...] as well as be able to undo or revert things so it should be part of the
tooling itself". Before this round the AI panel ("Build with AI") floated over the canvas, was reachable only
from File, the canvas right-click and Ctrl+K, and worked only by copying a prompt to another tab.

### Direction change: agents first, no API keys

The owner, after round 6 shipped: AI here "was supposed to be something that we could primarily use with
the browser built-in agents or anything that could browse our site and not for manual interactions", and
"we don't accept API keys". So:

- **Removed:** Connect a model (the header's key, "Or connect your own model…"), the Claude, OpenAI and
  Gemini adapters and the agent loop that called them, key storage and its redaction. A one-time cleanup
  on load deletes the key a visitor may have stored while that shipped.
- **The panel shows what agents did.** Every WebMCP call that changes the diagram (`edit_diagram`,
  `set_simulation`, `new_diagram`) is a turn: the agent's note (the tools' new optional `summary`), what
  changed, Undo this change (bound to its own history step), Revert to here and the hover highlight,
  recorded even while the panel is folded. Idle, the panel says how to use AI here ("Ask your browser's AI
  assistant, or any agent that can use this page…") and a status line says whether this browser offers
  the page's tools, linking agents that drive pages to llms.txt when it doesn't.
- **No request box in the main view.** Without a model, a box that "sends" would be dishonest. The selection
  right-click's Change with AI… became **Copy for AI**: the elements' ids and labels on the clipboard, for
  the request the person gives their agent. It never opens a fake composer.
- **Advanced** (closed by default, remembered) keeps the copy-and-paste flow, Explain and live Simulate,
  fully working. **Build with AI** left the start card and the File menu; Ctrl+K keeps it as the one
  discreet entry, opening Advanced on a blank diagram.
- **Name:** it's the **AI panel**: "Ask AI" promised a conversation the panel no longer has.
- **Folded in from the round-7 review:** the top bar's Ask AI button is gone (the bar is back to 7; the
  always-visible rail, Ctrl+I, the canvas right-click and Ctrl+K open the panel, and with the panel now an
  activity log there's no need to push it from the top bar). While the panel is open an AI change shows no
  toast (the turn has the Undo; one Undo, not two). Stencil-choice chips leave a turn once its node changed
  (undo, revert, an edit) instead of sitting there disabled. Advanced's placeholder names a node that's in
  the diagram. The dock's frame is no longer a second landmark around the panel's region.
- **Lead review:** an idle open panel spent about 360 px of a 1024 screen on explanation, so the panel
  starts folded to its 40 px rail on a first visit (then stays as the person left it). An agent's change
  never opens it or moves the canvas; while folded, the rail's spark shows a count of the agent changes not
  yet seen in this diagram ("AI panel, 2 new changes"), cleared by opening the panel. No AI change toasts
  while the panel is open, for any tool, and a toast left from a change made while folded goes when the
  panel opens (its turn has the Undo). With Build with AI off the start card, round 7's rule hiding it
  while the panel is open went too.

Chrome: the top bar goes from 8 to 7, the start card and the File menu lose an item each, the node, edge
and selection menus swap Change with AI… for Copy for AI (same count), and the panel's composer moves
into Advanced.

### Decision: a docked column, beside the inspector

**Ask AI** is a column at the window's right edge, outside the canvas: stencil rail | canvas | inspector |
Ask AI. The canvas shrinks to make room; nothing floats over the diagram. Folded, it is a 40 px **rail**
with the spark, so AI is always in sight. Open state and width (300–640 px, drag or ←/→ on its edge) are
one remembered setting.

Layouts considered:

1. **Tabs in one right column with the inspector.** Rejected: you select a node to point the AI at it, and
   selection opens the inspector, so the conversation would keep tabbing away mid-request.
2. **AI on the left.** Rejected: the stencil rail lives there, and people know chat panes at the right edge
   (VS Code, Cursor).
3. **Stacked under the inspector.** Rejected: both get half of 900 px; the composer and the inspector's
   fields would both scroll.
4. **Chosen: its own column, right of the inspector.** The inspector is about the selection and sits next to
   it; Ask AI is about the whole diagram and spans the editor and live view. Below 1280 px an open dock
   keeps the inspector folded to its 52 px rail until it's opened by hand (one click), so at 1024 the canvas
   keeps about 560 px: 1024 − 52 (stencil rail) − 52 (inspector rail) − 360 (dock).

### Entry points

| Where                       | What                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Top bar                     | **Ask AI** (spark and label; icon-only below 1100 px, same tooltip and accessible name)  |
| Right edge                  | The rail's spark when folded; the panel's **Hide Ask AI** chevron when open              |
| Keyboard                    | **Ctrl+I** shows and focuses it; from inside it, hides it (Ctrl+Shift+M stays dictation) |
| Canvas right-click, Ctrl+K  | **Ask AI…** (edit and live)                                                              |
| Node, edge, selection menus | **Change with AI…**: the selection becomes a removable chip on the request               |
| Start card, File, Ctrl+K    | **Build with AI**: a new blank diagram with Ask AI ready                                 |
| Hidden                      | Presenting, embeds (`?embed=1`), the Stencils tab and the Lab (there's no diagram there) |

### The panel per context

| Context                  | Empty-state heading        | Suggestion chips (thread empty)                                               | Intent             |
| ------------------------ | -------------------------- | ----------------------------------------------------------------------------- | ------------------ |
| Empty canvas, start card | Build with AI              | Three starter systems                                                         | none               |
| Editor                   | Change this diagram        | Add a cache, a dead-letter queue, group into boundaries; Explain this diagram | Change · Explain   |
| Selection chip           | Change the selection       | Scale it out, add a retry queue; Explain it                                   | Change · Explain   |
| Live view                | Simulate a scenario        | A storm at 9am, a failing dependency, a slow ramp; What's happening?          | Simulate · Explain |
| Local-only diagram       | AI is off for this diagram | none: the note says why, and nothing is sent                                  | none               |

- **Change / Simulate** apply as one undo step and add a turn. In live view the reply is a simulation
  (`set_simulation`): it's saved to the diagram, appears in the live bar's picker and plays at once.
- **Explain** never changes anything. With a connected model the answer is a turn of text; with copy and
  paste the prompt is copy-only (the reply box and Apply step aside). In live view it includes the running
  numbers.

### The conversation

One per diagram, in this browser only (never in the file, exports or share links). A turn shows the request,
the AI's words (plain text, never HTML) and "+3 nodes, +2 connections". The latest turn offers **Undo this
change**; earlier turns offer **Revert to here** (one undo step, and a turn of its own, so it can be undone
too). Hovering or focusing a turn outlines what it touched. **Clear conversation** is undoable from its
toast. Caps: 40 turns; the newest 10 keep their snapshot for Revert.

### Engines (superseded: see "Direction change" above)

- **Your model** (optional): **Connect a model**: Claude (Haiku 5.5 by default, or Sonnet 5.5), OpenAI or
  Gemini, called from the browser with the user's key. The key stays in this browser ("Stored only in this
  browser and sent only to Anthropic"), with **Forget key**; it never reaches files, links, logs or error
  text. The model edits through the same validated ops as WebMCP (`describe_diagram`, `find_stencils`,
  `edit_diagram`, `set_simulation`) on a draft, and the whole request lands as one undo step. Its words
  stream into the turn.
- **Copy and paste** (always there): **Copy prompt**, paste the reply, **Apply**. With a key, **Copy prompt
  instead** keeps it one click away.

### Copy

Ask AI · Hide Ask AI · Build with AI · Change with AI… · Change this diagram · Simulate a scenario ·
Explain · Copy prompt · Paste the reply · Apply · Send · Undo this change · Revert to here · Undone ·
Clear conversation · Connect a model · Forget key · AI is off for this diagram.

### Chrome count

| Surface                        | Before                                 | After                                               | Budget |
| ------------------------------ | -------------------------------------- | --------------------------------------------------- | ------ |
| Top bar                        | 7                                      | 8 (Ask AI)                                          | ~7     |
| Right edge                     | Inspector                              | Inspector and Ask AI (a 40 px rail when folded)     |        |
| Canvas right-click (edit/live) | 11 / 9 ("Build with AI…" in edit only) | 11 / 10 ("Ask AI…" in both)                         | ≤ 12   |
| Node right-click (edit)        | 10                                     | 11 (Change with AI…)                                | ≤ 12   |
| Edge right-click (edit)        | 9                                      | 10 (Change with AI…)                                | ≤ 12   |
| File menu                      | Build with AI… (opened the panel)      | Build with AI… (a new diagram), next to New diagram | ≤ 12   |

The top bar goes one over its ~7 budget, on the owner's explicit request that AI be visible on every
screen; below 1100 px the button is an icon, and the bar is checked for overlap at 1024. If the bar grows
again, fold the theme toggle into View.

### Built, then checked

Built as designed, then walked in Chrome at 1440, 1280 and 1024, light and dark: the empty canvas with the
start card, the editor with a two-turn thread (hovering a turn outlines its nodes), a selection chip, live
view after a pasted scenario (saved, picked and playing), Explain in live view, and Connect a model. At 1024
the top bar keeps every control in one row with no overlap (Ask AI is an icon), and with the dock open and a
node selected the inspector stays on its rail, leaving the canvas about 560 px. `tests/e2e/ai-context.spec.ts`
measures both with bounding boxes.

The lead's review then fixed three overlaps, each checked with bounding boxes at 1024 and 1440
(`tests/e2e/ai-layout.spec.ts`):

- **Toasts stack** above the canvas's bottom bars (the first-run hint, the live bar) instead of covering
  them: one bottom-centre stack. Bars opt in with `data-toast-avoid`; the toast follows them while it shows.
- **The first-run hint never cuts a word.** It sizes to the pane, not the window: a narrow pane keeps the
  live hint only ("Go live to …"), and a very narrow one lets it wrap.
- **The dock keeps the diagram in view.** Opening, closing or resizing it (by 40 px or more) refits a fitted
  view to the new pane; a view the user panned or zoomed is panned just enough to keep the selection (or,
  with none, the diagram's centre) in view.

Connecting a model was only a key icon; the copy-and-paste composer now also says **Or connect your own model
to apply changes directly**, and an unknown model's error says to check the model name.

## Round 5: UX gate after message trace and sequence diagrams

Reviewed 2026-10-11 against `docs/UX-PRINCIPLES.md` on a production build (`pnpm build && pnpm preview`,
public examples only), in Chrome at 1920×1080, 1440×900 and 1024×768, dark and light, in the editor and
in presentation. Three personas walked the real app:

1. **Presenter explaining one order:** Kafka example → Live → trace a message → watch it fan out →
   Sequence diagram → Copy as Mermaid. Is it obvious, beautiful and readable at a distance?
2. **Incident review:** Azure "Poison invoices" → Trace a message ▸ One that dead-lettered. Can you
   say why it died in under 30 seconds?
3. **Returning engineer:** recount the live chrome: both live menus, ⋯, the palette entries, and the
   panels that can be open together (trace card, Inputs & capacity, inspector, narration).

Overlap was measured with `getBoundingClientRect` against the labels the renderer now reports on the
live canvas (`data-trace-labels`), sampled every 60–80 ms through a whole fan-out.

Screenshots: `docs/screenshots/ux-gate5-before-*.png` and `ux-gate5-after-*.png`.

### Scorecard

Scores are out of 5. "Before" is the app at the start of this round (round 4 ended at 4–4.5).

| Principle                       | Before | After | Why                                                                                                                                                                                         |
| ------------------------------- | :----: | :---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Beautiful by default         |  3.5   |  4.5  | Trace labels sat on node cards and badges at 9 px. The sequence dialog was a fixed 1180 px window onto a 2170 px picture.                                                                   |
| 2. Progressive disclosure       |  4.5   |  4.5  | Unchanged. The hop list, the sequence diagram and its exports stay one step away.                                                                                                           |
| 3. Context over chrome          |  4.5   |  4.5  | Unchanged. Click a particle, right-click a node, or Trace a message ▸ on the canvas.                                                                                                        |
| 4. One primary action / surface |   4    |   4   | Unchanged. Sequence diagram on the card, Copy as Mermaid in the dialog.                                                                                                                     |
| 5. Budget the chrome            |  4.5   |  4.5  | Nothing added: ⋯ keeps 6 rows, the live canvas menu 9. Fit, pinning and stacking are defaults, not controls.                                                                                |
| 6. No dead ends                 |   4    |  4.5  | "Nothing has dead-lettered yet" stayed up beside a card already saying Dead-lettered.                                                                                                       |
| 7. Consistent names             |   4    |  4.5  | ⋯ "Trace a message" only traced the next message; the same words on the right-click and in Ctrl+K offer three choices.                                                                      |
| 8. App, not page                |  4.5   |  4.5  | Unchanged. The sequence view now always opens at its top-left corner.                                                                                                                       |
| 9. Teach in place               |  4.5   |  4.5  | Unchanged. ⋯'s hint names both ways to trace (right-click a node, click a moving message).                                                                                                  |
| 10. Nothing overlaps            |  2.5   |  4.5  | Labels covered node titles. With Inputs open the card sat over the diagram and the narration covered the card. Opening the card shrank the diagram by 30–50% to clear a full-height column. |
| 11. Presentation first-class    |  3.5   |  4.5  | Tracing an order dropped a 1440 view from 58% to 41% zoom, and 1024 from 39% to 20%: unreadable from the back of a room. Labels were 9 px.                                                  |

### Chrome count

| Surface                         | Before                                                           | After                                                             | Budget |
| ------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| Top bar                         | 7                                                                | 7                                                                 | ~7     |
| Live canvas right-click         | 9 (Trace a message ▸ with 3)                                     | 9, unchanged                                                      | ≤ 12   |
| Live node right-click           | 7 (with Trace next message from here)                            | 7, unchanged                                                      | ≤ 12   |
| Live edge right-click           | 3 (Highlight this path, Edit label, Properties)                  | 3, unchanged                                                      | ≤ 12   |
| Live ⋯ menu                     | 6 rows; "Trace a message" = next message only                    | 6 rows; "Trace a message" unfolds the same 3 choices in place     | ≤ 12   |
| Palette, trace                  | Trace a message (drill) + 3; End trace while tracing             | Unchanged                                                         |        |
| Trace card                      | Sequence diagram (primary), close                                | Unchanged                                                         |        |
| Sequence dialog                 | Copy as Mermaid (primary), SVG, PNG                              | Unchanged (fit and pinned participants are automatic)             |        |
| Floating surfaces open together | Trace card, side panel, narration, event log, bottleneck callout | Same five; the trace card heads the side panel's column when open |        |

Net: no control added or removed. One row changed behaviour (⋯ Trace a message); the rest are defaults.

### Findings

**P0 (all fixed)**

1. **Trace labels covered node cards and each other.** Labels tried four corners around their particle
   and skipped a corner only if another label was there, so on the Kafka fan-out `OrderPlaced`,
   `PaymentCompleted` and `InventoryReserved` sat on the Payments, Inventory and Notification cards
   (titles included) and on their throughput badges. Labels now (`src/live/traceLabels.ts`, unit-tested):
   - merge copies with the same words close together (`OrderPlaced ×3`);
   - try 8 spots around the particle at 5 distances, and past the first ring draw a leader line back to it;
   - never cover a node card, its badges, another label or floating chrome (card, bar, panels, title),
     and avoid edge labels and other traced particles when there's a choice;
   - keep last frame's spot while it stays free, so they don't hop between corners;
   - leave a label out when there's no room (the card lists every hop);
   - go dead letters first, then retries, then the newest copy, and never drop below 11 px.
2. **The sequence dialog lost its participants.** Scrolling down a 13-participant journey took the
   names away, and the fixed 1180 px window showed half the picture. Now:
   - the participant boxes stay pinned at the top while the journey scrolls under them (a copy of the
     picture's header, so it lines up to the pixel; the exported SVG and PNG are unchanged);
   - the view always opens at its top-left corner;
   - the dialog is as wide as the journey needs, up to the window. A journey a little too wide shrinks
     to fit (down to 80%); a much wider one scrolls at full size. 13 participants fit at 84% at 1920.
3. **Tracing shrank the diagram.** The card reserved a full-height 400 px column, so on the wide Kafka
   example the view went from 58% to 41% zoom at 1440 and from 39% to 20% at 1024. The fit now keeps
   clear of the card's first rows only (a wide diagram moves down instead of shrinking), and the card
   grows down to the first node under it, its hops scrolling. Now 58% → 57% and 39% → 38%.
4. **With Inputs & capacity open, the card covered the diagram and the narration covered the card.**
   The card moved 456 px in from the right, onto the canvas, where the narration card (which didn't
   know about it) landed on top. With a side panel open the card now heads the panel's column and the
   panel starts below it. The narration card keeps clear of the trace card everywhere.

**P1 (fixed)**

5. **⋯ "Trace a message" only traced the next message.** The incident reviewer looks in the visible
   chrome first, and "One that dead-lettered" wasn't there. The row now unfolds the same three choices
   as the right-click's Trace a message ▸ (Next message, Slowest so far, One that dead-lettered). ⋯ still
   has 6 rows.
6. **A stale notice.** "Nothing has dead-lettered yet: the next message that does will be traced"
   stayed up to 3 s after the card already said Dead-lettered. It now goes as soon as the trace has its
   message.

**Verified, no change needed**

- **Highlight this path vs Trace a message:** both stay. They differ in target (an edge vs a message),
  icon (route vs trace) and result (a static downstream view now, vs one real message's hops and
  timings). The names share no word.
- **Incident review:** right-click → Trace a message ▸ One that dead-lettered, and in about 15 seconds the
  card reads: Dead-lettered (red), 4 retries (amber), "Ledger worker: attempts 1–5 failed", "dead-lettered
  after 5 deliveries", then the DLQ hop. The narration names the cause (a schema mismatch).
- **Presenter:** Copy as Mermaid is the dialog's one primary action and toasts "Copied the sequence
  diagram as Mermaid." SVG and PNG are secondary. In presentation the labels scale up with the particles.
- **Light and dark:** labels are white on the message colour in both; leader lines take the same colour.
- **Esc** still backs out one level: dialog, selection, trace, live view.

**P2 moved to the backlog**

- A narration close-up (e.g. Poison invoices at 1440) crops nodes at the left under the rail and the zoom
  controls; the note fit only guarantees the focused nodes.
- On Azure, a node's badge ("29 queued") can sit on an edge label ("After 5 failed deliveries").
- At 1440 a 13-participant sequence scrolls sideways (fitting it would take 63%, too small to read).
  A "whole journey" zoom could help presenters, if anyone asks.
- In presentation at 1920, wide diagrams show node titles at about 9 px; a camera that follows the
  traced path would read better at a distance.
- Hop rows in the trace card truncate "as PaymentCompleted" at 352 px.

### What changed, in numbers

- **Removed or merged:** nothing removed. ⋯ "Trace a message" now holds the same three choices as the
  right-click (one row, as before).
- **Renamed:** none.
- **Moved:** the trace card, from over the canvas to the top of the side panel's column while a panel
  is open.
- **Better defaults (no new controls):**
  - de-collided trace labels with leader lines and merged copies
  - a trace fit that costs no zoom on wide diagrams, and a card that stops above the first node
  - pinned participants, start-of-journey scroll and fit-to-width in the sequence dialog
  - the narration card keeping clear of the trace card
  - the stale dead-letter notice clearing itself

## Round 4: UX gate after annotations and Record video

Reviewed 2026-10-11 against `docs/UX-PRINCIPLES.md` on a production build (`pnpm build && pnpm preview`,
so private examples never load), in Chrome at 1920×1080, 1440×900 and 1024×768, dark and light. Three
personas walked the real app:

1. **Explainer:** annotates the Kafka example for a design doc (a title, two notes, a zone, a shape),
   then exports a PNG.
2. **Presenter:** records a narrated simulation for Slack, from finding "Record video…" through the
   countdown, Stop, review and download.
3. **Returning engineer:** after four feature batches, is the app still calm? The chrome was counted
   again with a script that opens each menu and reads its rows, and one that reads the inspector for
   each kind of selection.

The exported PNG was captured in the page and viewed at full size; overlap was measured with
`getBoundingClientRect`.

Screenshots: `docs/screenshots/ux-gate4-before-*.png` and `ux-gate4-after-*.png`.

### Scorecard

Scores are out of 5. "Before" is the app at the start of this round (round 3 ended at 4–4.5).

| Principle                       | Before | After | Why                                                                                                                                                                                               |
| ------------------------------- | :----: | :---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Beautiful by default         |  3.5   |  4.5  | The exported PNG drew every edge and every shape as a black blob. Text set to XL wrapped and spilled out of its box. In dark mode a yellow note read as one more node card.                       |
| 2. Progressive disclosure       |   4    |  4.5  | The rail showed 8 annotate tiles for 4 kinds. A Text showed a Size row it doesn't need, a zone a Text size, and Record video asked about presentation view on every take.                         |
| 3. Context over chrome          |  4.5   |  4.5  | Unchanged. Annotations are edited in place, with handles, and in the inspector.                                                                                                                   |
| 4. One primary action / surface |   4    |   4   | Unchanged. Start recording, then Download, are each dialog's one primary action.                                                                                                                  |
| 5. Budget the chrome            |   4    |  4.5  | The canvas menu sat at its 12-item cap. It's 11 now (live 8), with room for the next feature.                                                                                                     |
| 6. No dead ends                 |  4.5   |  4.5  | Unchanged. Discarding a recording is undoable; an emptied text removes itself (undoable).                                                                                                         |
| 7. Consistent names             |  3.5   |  4.5  | "Add node here" sat over a bare "Add ▸" while the rail said "Annotate". The rail said "Box" where the menu says Rectangle. The zone label was tracked capitals. Record video had two icons.       |
| 8. App, not page                |  4.5   |  4.5  | Unchanged. Inline editing commits on Esc, Ctrl+Enter or a click away; menus and dialogs are keyboard-complete.                                                                                    |
| 9. Teach in place               |  3.5   |  4.5  | The Annotate group was the rail's last section, below 25 Messaging stencils: off-screen on a first visit at every width. It's now a pinned row.                                                   |
| 10. Nothing overlaps            |   3    |  4.5  | A click in the rail dropped annotations at the view's centre: on the busiest nodes, stacked on each other, and (notes, shapes) pushing edges into detours. At 1024 the diagram card covered Live. |
| 11. Presentation first-class    |  3.5   |  4.5  | Live dimmed annotations to 60%, in presentation and in recordings. A selected zone kept its resize handles on stage. Empty notes showed "Double-click to write" in the PNG and in presentation.   |

### Chrome count

| Surface                               | Before                                                                                  | After                                               | Budget |
| ------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------- | ------ |
| Top bar                               | 7                                                                                       | 7                                                   | ~7     |
| Stencil rail sections                 | 8 categories + Annotate (8 tiles, last, below the fold)                                 | 8 categories + a pinned Annotate row (4 tiles)      |        |
| Canvas right-click, edit / live       | 12 / 9                                                                                  | 11 / 8 (Fit view: control, Shift+1 and Ctrl+K only) | ≤ 12   |
| Canvas "Add ▸", now "Annotate ▸"      | 4 (Text, Note, Zone, Shape ▸ with 5)                                                    | 4, same rows                                        | ≤ 12   |
| Live ⋯ menu                           | 4 (Continuous traffic, Step ¼ second, Event log, Record video…)                         | 4, unchanged                                        | ≤ 12   |
| Inspector, node / edge / boundary     | 4 fields + 2 sections / 4 + 2 sections / 2                                              | Unchanged                                           |        |
| Inspector, text / note / zone / shape | 4 / 4 / 4 + 2 notes / 5 fields                                                          | 3 / 4 / 3 + 1 note / 5                              |        |
| Record video setup options            | 2 checkboxes (1 in free play)                                                           | 1 (only with a simulation; none in free play)       |        |
| Side panels                           | 6: stencils, inspector, Inputs & capacity, simulation editor, event log, narration card | 6, unchanged                                        |        |
| Dialogs                               | 9 + shortcuts sheet + palette (Record video and Your recording are new)                 | Unchanged                                           |        |
| Ways to add an annotation             | Rail, right-click, palette, T                                                           | Unchanged                                           |        |

Net: 6 fewer controls (4 rail tiles, 1 canvas-menu row, 1 record option) and 2 fewer inspector rows
(Size on text, Text size on zones), with one help note merged. Nothing was added to any surface; every
fix is a better default.

### Findings

**P0 (all fixed)**

1. **The PNG export drew edges and shapes as black blobs.** html-to-image copies computed styles onto
   HTML elements only; SVG children keep just their attributes, so every edge path, arrowhead and
   annotation shape lost its CSS fill and stroke and rendered black. It wasn't new with annotations: edges
   are painted by CSS, so every PNG export was affected. Export now writes each SVG child's
   computed paint onto it for the shot and restores it afterwards (`src/interop/image.ts`).
   - The picture also leaves out editing state: selection outlines, resize handles and an empty
     note's "Double-click to write".
2. **Click-to-add stacked everything at the view's centre.** A click on a rail tile (or a palette
   command without a target) put the new annotation or node at the centre of the view. On the Kafka
   example that's inside the boundary, over edges. Text, a zone and a shape landed on one spot. A note
   or shape there is a routing obstacle, so nearby edges detoured around it.
   - Now it goes to the free place nearest the centre: clear of nodes, boundaries, other annotations
     and edges, by 32px (`placeFree` in `src/canvas/placement.ts`, unit-tested).
   - A right-click or a drop still puts it exactly where you pointed.
3. **A new text size didn't resize the text.** Text is 200×30 at M. At XL a one-line title wrapped to
   two lines and spilled out of its box, past the selection outline and the export bounds. Changing
   the size now scales the box with the type (one undo step), so a title stays one line.

**P1 (fixed)**

4. **Annotations were dimmed while presenting.** Live view dims annotations to 60% so the messages
   lead. That also applied in presentation and in recordings, so the author's title and notes looked
   disabled on stage. They're at full strength when presenting; only the editing live view keeps them
   quiet.
5. **Selection chrome on stage.** A selected zone kept its resize handles and solid border in
   presentation. Presentation hides annotation handles, outlines and placeholders.
6. **The Annotate group was buried.** It came last in the rail, under 25 Messaging stencils, so a
   first visit never saw it at any width. Its 8 tiles gave shapes 5 of 8 slots, and the rectangle was
   called "Box". It's now one row of four, **Text, Note, Zone, Shape**, pinned under the list, so it's
   always in view.
   - Shape starts as a rectangle; the inspector, the right-click's Shape ▸ and the rail search
     ("ellipse", "cylinder") pick an outline directly.
7. **"Add node here" sat over a bare "Add ▸".** The submenu is now **Annotate ▸**, the rail's word.
   The palette reads "Annotate › Note".
8. **The canvas menu was at its 12-item cap.** Fit view is always on screen (canvas controls) and on
   Shift+1, so it left the right-click: 12 → 11, live 9 → 8. It's still in Ctrl+K: the registry's new
   `paletteOnly` flag keeps an action out of menus and in the palette.
9. **The zone label was tracked capitals** ("OBSERVABILITY"), the one label left breaking sentence case.
   It's now plain sentence-case words in the zone's colour.
   - Zone vs boundary still reads at a glance: a dashed edge and plain words against a solid edge and a
     label chip with a swatch.
10. **Menu-added text was centred on the click,** so a title right-clicked near the left edge started
    under the stencil rail. Text now starts where you clicked, as `T` does.
11. **Record video asked about presentation view every time.** Nobody wants editing chrome in a Slack
    video, so every take is in presentation view and the option is gone. The setup now says what's
    captured: "Only the diagram is recorded, in presentation view (no editing controls, larger text),
    without sound." With a simulation picked, the one option left is to play it from the start.
12. **At 1024 the diagram card covered the Live toggle** with both side panels open (the canvas is
    480px wide there). The card now leaves room for it at any width, in presentation too.
13. **The annotation inspector showed more than it needed.**
    - A Text sizes itself, so its Size row is gone (handles still set its width).
    - A zone's label has one size, like a boundary's, so its Text size row is gone.
    - The zone's two help notes are now one: "A zone only marks an area: nodes don't move with it. To
      keep nodes together, use a boundary."
14. **Record video had two icons:** a monitor in the right-click and a record dot in ⋯. Both use the
    record dot now.
15. **Dark-mode notes read as node cards.** They were dark grey with a thin colour band. The paper now
    carries a little more of its colour, so a yellow note reads as a note.

**Verified, no change needed**

- **Record flow (presenter):** "Record video…" is in the live ⋯ menu and the live right-click. The
  steps are setup, the browser's share prompt, a 3-2-1 countdown ("Esc cancels") and a small pill
  (time, Stop). The live bar and the Live toggle stay out of the take. **Your recording** has a
  preview, the duration and size, Download as the primary action, and Discard with Undo. With a
  simulation picked, "Play from the start" stops by itself; pausing notes hold 5 seconds.
- **Inline editing:** double-click edits in place, Enter adds a line (a zone label is one line), and
  Esc, Ctrl+Enter or a click away commits. Emptying a text removes it (undoable).
- **Resizing:** corner and edge handles on the selection, with min sizes per kind.
- **Colour:** six swatches, the same component as boundary colours.
- **Smaller round-3 follow-ups:**
  - Timeline markers are clickable.
  - Expectation results stay readable in a narrow live bar.
  - Traffic into X places the entry point beside the node.
  - The narration card avoids nodes and chrome.
  - No overlap at 1024 in live with a simulation.

**P2 moved to the backlog**

- The PNG has no title, so explainers add a Text by hand. The export could include the diagram's
  title and description, as presentation does.
- A text that grows (a bigger size, a longer line) can run over an edge, because text isn't a routing
  obstacle. Consider nudging it clear, as placement does.
- With nodes selected, "Annotate ▸ Zone" could draw the zone around them.
- Typing a longer text in the inspector doesn't grow a Text's box; typing in place does.
- At 1024, selecting an annotation near the right edge opens the inspector over half of it; check
  `useKeepSelectionInView` covers annotations.
- In the Lab (no presentation mode) the Record setup still says "in presentation view".

### What changed, in numbers

- **Removed or merged:**
  - 4 annotate tiles (5 shape tiles became 1)
  - Fit view from the canvas right-click (edit and live)
  - the Record video "Presentation view" option
  - Size on Text and Text size on zones in the inspector
  - one of the zone's two help notes
  - the 60% dimming of annotations while presenting
- **Renamed:** Add ▸ → Annotate ▸ (palette: Annotate › …). Box → Shape (Rectangle in search). The
  zone label, from tracked capitals to sentence case. The right-click's Record icon matches ⋯.
- **Moved:** the Annotate group, from the end of the rail's list to a pinned row under it.
- **Better defaults (no new controls):**
  - free-space placement for click-to-add
  - text that scales with its size
  - PNG export with real edge and shape paint and no editing state
  - presentation without selection chrome
  - recording always in presentation view
  - a diagram card that never covers Live

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

## Slow motion UX review — 2026-10-11

Passed after addressing two findings: returning from replay to a waiting watch now restores live
speed, and the command palette disables simulation switching during slow motion.

- Replay starts at 1×, its pace remains adjustable, and exit restores the previous live speed.
- Visited offsets are smaller, muted and increasingly faint with age. They never cover node cards,
  existing labels, captions or each other; crowded offsets wait for room.
- Folded retries show a compact `↻ ×N` chip beside the retrying node only during that beat.
- Engine-changing actions share registry availability and the hint "Exit slow motion (Esc) first".
  Trace, event inspection, sequence diagrams and recording remain available. Open Inputs fields and
  Apply fix wait until replay ends.
- Existing play, replay, speed and timeline controls serve slow motion. No toolbar control was added;
  context menus and the palette retain progressive disclosure.

Regression coverage includes pace restoration and the waiting fallback, painted offset styling and
collision checks, retry-chip timing, registry and palette availability, and the browser flows.

## Cross-lane hooks I added (small, isolated)

- `src/lib/canvasBridge.ts`: the Gallery queues stencil ids in `sessionStorage` and switches to the
  canvas with `history.pushState` + a `popstate` event (the existing URL-state hook picks it up).
  The canvas **palette** drains the queue 260 ms after mount, once React Flow has fitted the view,
  and records the open diagram's slug so "current diagram" means the last one you had open.
  There are no edits to `CanvasView.tsx` or `App.tsx`. `STENCIL_DND_MIME` lives here now; `Palette.tsx`
  re-exports it.
- Cursor-only rule edits in `canvas.css` (controls/inspector disabled buttons, group label, an
  appended "cursors" block) and `lab.css` (disabled buttons, share URL).

## AI panel — 2026-10-11

The panel stays inside the canvas beside the inspector, restores keyboard focus on close, and uses readable status ink in the light theme. Local-only diagrams show an exclusion note and cannot be sent through AI prompts or tools. Choices from earlier turns disable when their node changes or disappears and explain how to continue. Full-layout replies can apply without edit operations. Existing contextual entry points and the chrome budget remain sufficient. Geometry, focus, contrast, provenance and stale-choice browser regressions cover these interactions.

The privacy follow-up preserves the existing Duplicate, Save a copy, Import and Paste flows without adding controls. Library provenance and development content matching use the same AI exclusion decision; the existing inline note explains it. The source review found no blocking UX issues, and synthetic browser regressions verify blocked prompts and tool registration after copying, importing and reloading.

## Example loading — 2026-10-11

The picker, start card and palette retain their existing titles, groups and thumbnails with no added
controls. Opening an example keeps the current canvas and its edits visible until the download finishes;
the first deep-link load shows the existing loading status. A failed download keeps the current diagram
and uses a toast explaining how to recover. Lab previews load only their selected examples inside the
stage. Source review and browser coverage of delayed loads, failures, thumbnails and navigation found no
blocking UX issues.
