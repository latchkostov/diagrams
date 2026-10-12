# Backlog

Review findings and ideas not yet scheduled. Remove items when they land.

## On-device model

- Run the on-device evals (`?view=lab&preset=ondevice-evals`, see `docs/research/on-device-model.md`) in a
  Chrome with the model and record the rate. The box is on by default since round 3 (the 80% bar reached by
  projection only): if a measured run falls short, decide whether to turn `ON_DEVICE_DEFAULT` back off.
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

- **Live input latency: landed (particles, marching ants and the Live dot draw in a worker).** Menu and
  palette feedback while live took 24-40 ms (edit mode: under 16) because something repainted on the
  main thread or the compositor every frame: the particle canvas, the `lv-march` dash animation and the
  Live dot's `lv-breathe` box-shadow each held input a frame deeper on its own (any one of the three
  kept it at 24-40 ms). A compositor version of the dot (an opacity cross-fade) still cost 8-16 ms. Now
  all three draw on `OffscreenCanvas`es in a module worker (`src/live/liveRenderer.ts`,
  `particleWorker.ts`); the main thread steps the engine and posts one message per frame, and the march
  stops while the simulation does. Measured with `node scripts/perf/live-latency.mjs --headed`
  (production build, Kafka example at 1x, Chromium, 100 Hz display; Event Timing p50 / p90, which
  rounds to 8 ms and doesn't report under 16 ms; main-thread task time over 5 s of traffic):

  | Live, playing                   | Menu hover | Menu arrows | Palette hover | Palette arrows | Main thread           | Particle frames |
  | ------------------------------- | ---------- | ----------- | ------------- | -------------- | --------------------- | --------------- |
  | Before, 1x                      | 40 / 40    | 32 / 40     | 40 / 40       | 32 / 40        | 10.5% (1.05 ms/frame) | 100 fps         |
  | After, 1x                       | 16 / 16    | 16 / 16     | 16 / 16       | 16 / 16        | 4.9% (0.49 ms/frame)  | 98.5 fps        |
  | Before, 4x (median of 3)        | 32 / 32    | 24 / 32     | 32 / 40       | 32 / 40        | 74.5% (7.5 ms/frame)  | 100 fps         |
  | After, 4x (median of 3)         | 16 / 24    | 16 / 16     | 16 / 32       | 24 / 24        | 21.7% (2.2 ms/frame)  | 98.7 fps        |
  | Fallback (`?renderer=main`), 1x | 40 / 40    | 32 / 40     | 40 / 40       | 32 / 40        | 10.2%                 | 98.8 fps        |
  | Fallback, 4x (median of 3)      | 32 / 32    | 24 / 32     | 24 / 32       | 32 / 40        | 58.6%                 | 98.5 fps        |
  | Edit mode, 1x (calibration)     | <16 / 24   | <16 / <16   | 16 / 16       | <16 / 24       | 1.2%                  | -               |

  Paused, before: 9.9% main thread and 32-40 ms (the march and the dot kept animating); after: 2.1%
  and 16 ms. DevTools CPU throttling slows only the main thread, so at 4x the worker still drew at the
  display's rate. Follow-ups:
  - Any other endless animation shown while live costs the same frame: `tr-pulse` (the trace card's
    "In flight" dot), `lv-breathe-accent` (Continue while a note waits), `lv-rec-pulse` (recording) and
    the heat-map pulses below. Draw them on a worker canvas too, or make them still.
  - The fallback (no OffscreenCanvas or module workers, or the worker failed to start) keeps the old
    latency: it still draws on the main thread and the dot breathes in CSS.
  - The worker's frame and the main thread's canvas placement commit separately, so a fast pan or zoom
    could show particles a frame off their edges. Not seen in screenshots taken mid-pan.

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
  blurred box-shadows on the main thread. Not active in the measured Black Friday run. Moving them to the
  compositor won't help input latency (see above); draw them in the particle worker, or hold them still.
- **Startup**: about 300 ms of long frames at 4x on a cold canvas load (React Flow's first measure and
  routing). Worth a look once the canvas chunk is profiled with source maps.
