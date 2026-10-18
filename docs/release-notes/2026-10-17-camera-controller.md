## One camera controller for the canvas

Internal architecture. The canvas viewport has a single writer, `src/canvas/camera/controller.ts`. Call sites
dispatch events that carry their cause: panel, selection, placement, menu open and close, input, a move by hand,
Fit, Shift+0, Shift+2, a mode change, full screen, the Checks card, narration, a reveal request, and the pane
settling. A pure policy, `decide(state, event)` in `panePolicy.ts`, applies the agreed rules as a table. The
controller runs its commands one at a time.

- Pending pane work is data. It waits for two rendered frames that agree on the pane: React Flow's size matches
  the canvas, the selection is measured and no pointer is held. That replaces the 150 ms timer, a 30-frame
  fallback and a 280 ms second reveal pan. The work survives menus and runs once.
- At most one move is in flight. A new move replaces it, and reveals start from where it lands. Pans use linear
  interpolation, so the zoom holds while they run.
- There is one reveal geometry, overlay-aware, for selections, placements, keyboard navigation and focus, Checks,
  pane changes and Live's manual pane changes.
- Seven separate "refit if fitted" paths and six "reveal the selection" paths became policy rows. The six refs
  that tracked camera ownership (`showingAll`, `fitEpoch`, `inspectorPanCommand`, `fitStarting`,
  `fitTransition`, `earlyFit`) and the pane refs (`pendingPane`, `paneChange`, `keepInView`) are gone. The
  remaining memory is the policy state.
- Quick-add's room pans, the command palette's go-to, Shift+0, the exported HTML viewer's keys and zoom buttons,
  and the Checks reveal now go through the controller. ESLint rejects viewport calls outside `src/canvas/camera`.
  Live view and slow motion are allowlisted until they are folded in
  (`docs/backlog/2026-10-17-camera-live-slowmo.md`).
- Readiness for tests: `data-camera-state` on `canvas-wrap` reads `idle`, `pending`, `deferred` (a menu holds pane
  work) or `animating`. It holds from a pointer-up until the Inspector's pane change arrives, while a reveal waits
  for measurement, during a fit's refinement and while a move runs. `waitForCameraIdle` waits on it. E2E and
  development builds keep a command journal (`window.__cameraJournal`). Production builds drop it, and
  `noTestHooks()` fails a build that keeps it.
- Tests: table cases for every policy row, the invariant cross-product (648 cases over owner, cause, menu,
  selection, coverage, mode and Shift+2), and fast-check event sequences for the policy. Deterministic-frame
  controller tests run a fast-check model over arbitrary interleavings of events, frames and transition ends.
  `fast-check` is a dev dependency only.

### Behaviour changes

- **Rule (d):** a selection or placement that opens the Inspector, and Live's manual pane changes, use the
  overlay-aware reveal. An item under the minimap, controls or title card after the pane narrows is panned clear.
  An item inside the pane but within the old 40–72 px margin no longer moves.
- A placement's reveal is one pan (from where any pan in flight lands) instead of two pans 280 ms apart.
- A mode change (Live on or off, presenting) fits once for its new pane. The pane change from the same commit (the
  stencils folding) no longer queues a second refit.
- A manually zoomed view whose pane changes keeps a visible selection where it is. Before, it could recentre the
  whole diagram when the diagram's centre was near the edge.
- The command palette's "go to node" makes the view the user's, as Shift+0 does, so a later panel toggle no longer
  refits it. The HTML viewer's arrow keys and +/− do the same.
- Pane work waits while a pointer is held (dragging the AI panel's edge), instead of refitting 150 ms into a pause.

### Output parity

See the PR description for the goldens' result.
