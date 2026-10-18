## Fold Live and slow motion into the camera controller

The canvas camera has one writer (`src/canvas/camera/controller.ts`), but Live view and slow motion still move
the viewport themselves. `src/live/LiveSession.tsx` keeps `zoomedForNote`, `panelFitted`, `cardFitted` and
`dockFitted`, with 160/320, 320, 120 and 200 ms timers and React Flow's `fitView` (string paddings). The
capacity panel and entry-point reveals use two 260 ms timers. `src/live/slowmo/useSlowMotion.ts` keeps
`following`, `panUntil`, `plan` and `fittedPane`, with 180 and 200 ms timers and per-frame follow pans. The
lint rule in `eslint.config.js` allowlists these two files only.

The controller tells these moves apart as foreign programmatic moves: a start without an event while none of its
own moves is starting. It stops its own fits for them, as before. They aren't in `data-camera-state` or the e2e
journal yet, so Live specs keep `waitForStableViewport`.

This was left out of the controller PR to keep it reviewable, and because the perf 5 branch is editing
`LiveSession.tsx`. Plan, one step per commit:

1. Events: `narration(focus)` (exists in the policy), `live.panel(open)`, `live.card(open)`, and
   `pane.changed(panel)` in live mode (today the policy drops it, P2). Add policy rows: in live view a panel
   change refits a `fit` view, refits a `narration` view to the note's focus, and reveals for a `manual` one.
   Slow motion becomes owner `slowmo`, so pane changes leave its plan alone.
2. Commands: a `liveFit` with Live's padding (the trace card's and panel's columns) and `noteFit(focus)`. Port
   `fitBesideCard` and React Flow's `fitView({ nodes, padding })` geometry into `camera/geometry.ts`. Use the same
   numbers, so the Live specs and goldens don't move.
3. Replace each timer with the pane settle the canvas already uses. The narration timer waited out "the canvas's
   own refit (~80 ms)": the controller serialises them now. Delete the four refs.
4. Slow motion: `planCamera` and `followPan` stay as geometry. The controller runs the plan's fit and the follow
   pans as commands that can be interrupted, with `panUntil` as in-flight state. `following` becomes the owner
   `slowmo` (a pan by hand gives it up, as today).
5. Remove the two files from the lint allowlist. Switch the Live specs (live, present, slowmo, the Live cases in
   followups4-inspector and inspector-resize) to `waitForCameraIdle` and add journal assertions.

Keep LiveSession edits away from the live tick (around line 535) while perf 5 is in flight.
