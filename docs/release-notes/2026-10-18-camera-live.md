## Live view and slow motion move the view through the camera controller

Internal architecture, with a few deliberate behaviour changes (`docs/design-review/2026-10-18-camera-live.md`).
Live view and slow motion no longer move the viewport themselves. Like the rest of the canvas, they dispatch
events with their cause, and the camera controller (`src/canvas/camera/`) runs the moves.

- **Events and policy rows.** Live sends `narration(focus)`, `live.panel(open)`, `live.card(open)` and
  `live.added`. Slow motion sends `slowmo(on, restore)`, `slowmo.take` and `slowmo.follow`. A pane change in
  live view now leaves work pending, where before it was dropped. The policy holds Live's room (the side
  panel, the trace card and the note's focus) and slow motion's state as data. It has new rows L1–L9 and
  W1–W7:
  - In live view, a panel change refits a fitted view with Live's fit (`liveFit`).
  - It refits a narrated view to the note's focus (`noteFit`).
  - It only reveals a manual view's selection and its connections.
  - A node Live adds comes into view once it is measured.
  - Slow motion owns the view as `slowmo`. A pan by hand gives it up, and when slow motion ends the view and its
    owner from before come back.
- **Same geometry.** `liveFit` and `noteFit` use Live's paddings and React Flow's own `getViewportForBounds`,
  and `fitBesideCard` moved into `camera/geometry.ts`. Durations are unchanged: 700 ms fits, 900 ms note
  close-ups and slow-motion plans, and 700 ms follow pans. Slow motion's `planCamera` and `followPan` stay in
  `slowmo/camera.ts` and are lent to the controller (`SlowmoCamera`).
- **Timers deleted.** The camera's timers are gone: Live's 160/320, 320, 120 and 200 ms, the two 260 ms reveal
  timers, and slow motion's 180 and 200 ms. Each piece of work waits for the pane to settle on rendered frames,
  the same rule the canvas uses. A pane change in live view arrives once from the canvas, so Live's own dock
  effect is gone.
- **Refs deleted.** In LiveSession: `zoomedForNote`, `panelFitted`, `cardFitted`, `dockFitted`,
  `manualPaneChange` and the padding refs. In useSlowMotion: `following` (now the owner `slowmo`), `panUntil`
  (now "a move is in flight") and `fittedPane`. Also gone: the props `paneChange`, `paneMenuOpen`,
  `onManualPaneChange`, `camera` and `paneRevision`, and the policy's `lastCause`.
- **Lint.** The viewport lint rule has no allowlist. The Lab's live stages get the same controller, through
  `useStandaloneCamera`, with Live's geometry only.
- **Tests.** There are table rows for every new row. The invariant cross-product now covers slow motion and Live
  (1,224 cases). Event sequences include Live's and slow motion's events: owner `slowmo` only while slow motion
  runs, its commands only then, and follow pans never while pane work waits. New controller tests cover each
  command. The Live specs wait for `data-camera-state="idle"` and assert the journal. For example,
  `liveFit:pane` for a fitted Live view (the journal didn't show this before), `noteFit:pane` while a note
  narrates, a `stop` for a paused replay, and `slowmoPlan` then `restore` around a replay.

### Fixes

- **Readiness after another writer's move.** A fit's move and its refinement could both be waiting for d3's
  next frame when the minimap or the zoom buttons moved the view. d3 cancelled both, and the minimap's move start
  was taken for ours, so `data-camera-state` stuck on `animating`. Now the port reads the d3 transition React
  Flow scheduled for each move (waiting, starting, running or ended). A start counts as ours only while ours is
  starting, and the move in flight is followed on frames until it ends. The interleaving model now drives a d3
  stand-in with foreign immediate and animated moves, refinements, and promises that never resolve. Every run
  drains to idle.
- **A fit in live view after hovering a node.** Live's hover tooltip borrowed React Flow's node test id and
  never gave it back. The measured gate found nodes by that id, so after a Fit command its refinement never ran
  and readiness stayed `pending`. This happens on master too. The gate now finds nodes by React Flow's `data-id`,
  and the hover restores the id.
- **Double-clicking an edge label in live view.** It traced the message passing behind the label. The trace
  card that opened then intercepted the next right-click, which caused a 1-in-340 flake of `text-fields` under
  load. The label pill now owns its clicks and hover, and a regression test holds a dot behind it.

### Output parity

Unchanged: Live's fits use the same numbers, and no golden moved.
