# Backlog

Review findings and ideas not yet scheduled. Remove items when they land.

## On-device model

- Run the on-device evals (`?view=lab&preset=ondevice-evals`, see `docs/research/on-device-model.md`) in a
  Chrome with the model and record the rate. At 80% or more, turn `ON_DEVICE_DEFAULT` on.
- Live view: scenario requests as simulations (`set_simulation`) need their own prompt and eval cases.
- Boundaries and notes aren't in the on-device op format yet.

## Your diagrams

- The library lives in `localStorage` (about 5M characters per site). If people keep many large
  diagrams, move documents to IndexedDB and keep only the index in `localStorage`.
- Device file handles (File > Save to a local file) are remembered for the session only; persisting
  them needs IndexedDB too.

## Engine gaps found while modelling real systems

- Layout lint for authors (overlaps, crossings, truncated labels) is in progress via the overlap audit.

## Live view and trace (UX gate 5)

- A narration close-up (e.g. Poison invoices at 1440) crops nodes at the left under the rail and the
  zoom controls; the note fit only guarantees the focused nodes.
- A node's badge can sit on an edge label (Azure: "29 queued" over "After 5 failed deliveries").
- At 1440 a 13-participant sequence diagram scrolls sideways (fitting would take 63%, too small to read).
  A "whole journey" zoom could help presenters, if anyone asks.
- In presentation at 1920, wide diagrams show node titles at about 9 px; a camera that follows the traced
  path would read better at a distance.
- Trace card hop rows truncate "as PaymentCompleted" at 352 px.

## Performance (measured 2026-10-11, production build, 4x CPU throttle)

- **Live input latency is pipeline depth, not main-thread work.** While particles move, hover and
  arrow-key feedback in menus takes 24-40 ms (16 ms in edit mode), even at 1x CPU: every frame
  commits a new particle canvas from the main thread, so input lands two frames deep. Moving the
  particle renderer to an `OffscreenCanvas` in a worker (paths and label rects sampled on the main
  thread and posted on change) would let the main thread idle between UI ticks.
- **Compositor-only animations raise that latency further.** Turning the Live toggle's breathing dot
  into an opacity cross-fade saved about 4% main thread but raised palette hover from 24 to 40 ms
  while live, so it was reverted. Re-measure input latency (Event Timing) before moving any live
  animation to the compositor.
- **Marching ants cost about 12% of the main thread while live** (`lv-march`, `stroke-dashoffset`,
  playing or paused): each frame restyles and repaints the viewport layer. Freezing the march while
  the simulation is paused (like the particles) would remove it there; a UX call.
- **Dragging a node in a 150-node diagram** spends about 6 ms per pointer move (1x) re-routing edges
  (`router.ts` → `routeOrthogonal`/`search`), plus React Flow's per-node wrappers: 80-104 ms per
  event at 4x. Route only edges whose corridor the moved node crosses, or route on `requestIdleCallback`
  and draw straight segments until then.
- **CanvasView re-renders on every drag frame, selection and zoom**, taking the inspector and React
  Flow's controls with it (34 renders for a 30-move drag). The stencil rail is memoized now; a memoized
  controls cluster and inspector (stable `nodeLabel`, `counts`, `onToggle`) would cut most of the rest.
- **Live UI clock**: every 125 ms the live view re-renders ~70 components (each NodeBadge, its icons and
  chips, the control bar). Cheap in production; in dev mode it saturates a throttled CPU (98% busy),
  which is what made menus feel slow in `pnpm dev`. Memoize `LiveIcon` / `IdleChip` and skip badges
  whose numbers didn't change.
- **Heat-map pulses** (`lv-heat-pulse` on rising nodes, `cap-pulse` on over-capacity rings) animate large
  blurred box-shadows on the main thread. Not active in the measured Black Friday run; convert only with
  the latency check above.
- **Startup**: about 300 ms of long frames at 4x on a cold canvas load (React Flow's first measure and
  routing). Worth a look once the canvas chunk is profiled with source maps.
