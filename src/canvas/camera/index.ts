// The canvas camera: everything that reads or writes the viewport, or decides when to.
//
// How it fits together
// - types.ts: the events (each with its cause), the commands, the policy state.
// - panePolicy.ts: decide(state, event) -> { state, commands }. Pure: the camera's rules, as a table.
// - controller.ts: the single writer. It feeds events to the policy and runs the commands one at a time, through
//   its port (React Flow and the DOM). Pending pane work is data in the policy state, it waits for the pane to
//   settle on rendered frames (never a timer), at most one move is in flight, and reveals start from where that
//   move lands. It publishes data-camera-state (idle | pending | deferred | animating) on canvas-wrap and, in e2e
//   and development builds, the command journal (journal.ts, window.__cameraJournal).
// - geometry.ts: where a fit, a reveal or a centring would put the view (pure reads).
// - use*.ts: the hooks CanvasView calls; they only dispatch events. useStandaloneCamera: the same controller for a
//   React Flow that isn't the canvas (the Lab's live stages), with Live's geometry only.
// - Live view (src/live/LiveSession.tsx) and slow motion (src/live/slowmo/useSlowMotion.ts) dispatch their own
//   events (narration, live.panel, live.card, live.added, slowmo, slowmo.take, slowmo.follow); slow motion lends the
//   controller its geometry (SlowmoCamera) and owns the view as `slowmo` while it runs.
//
// Adding camera behaviour
// 1. Add an event to CameraEvent (types.ts) with its cause, or a cause to an existing event.
// 2. Add a row to the table in panePolicy.ts and its case to decide(), plus a row in panePolicy.test.ts. The
//    invariant cross-product and the event-sequence tests there must still pass.
// 3. If it needs a new kind of move, add a command and run it in controller.ts (with its geometry in geometry.ts).
// 4. Dispatch the event from the call site that knows the cause.
// Never add an effect that moves the view, a timer that waits for "the pane to settle", or a ref flag that
// remembers who owns the view: the policy state is the only memory. ESLint (eslint.config.js) rejects viewport
// calls (setViewport, fitView, setCenter, zoomTo, ...) outside this directory, Live and slow motion included.
export { CameraContext, useCameraController, useCameraCore, type CameraCore } from "./useCameraCore";
export { createCameraController, type CameraController, type CameraPort, type JournalEntry } from "./controller";
export { decide, initialPolicy } from "./panePolicy";
export type { CameraEvent, CameraCommand, CameraPhase, PaneCause, PolicyState } from "./types";
export { FIT, FIT_PRESENT } from "./fitOptions";
export { useModeFit } from "./useModeFit";
export { useMoveHandlers } from "./useMoveHandlers";
export { usePaneCamera, type PaneInputs } from "./usePaneCamera";
export { panForConnectedMenu, useRevealFocused, useRevealIds, useRevealSelection } from "./useReveal";
