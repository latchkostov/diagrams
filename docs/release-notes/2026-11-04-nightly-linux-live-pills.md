## Live call pills without whole-frame relayouts

Call pills come and go with the traffic. In Focus, Follow and Overview, a pill that appears, disappears or changes its text is now placed on its own, against the settled frame's cards, labels, pins and readouts, before that frame paints. Previously each pill change re-measured every card and label and re-routed every pin, once per pill change: 34 whole-frame passes in the first 4.5 simulated seconds of Black Friday's "doors open", against one before the upgraded example gained explicit callers. Any other change under the canvas still runs the whole pass, as before. A thread meter keeps its slot dividers until its pool size changes, rather than rebuilding them on every Live update.

Placement, culling and counter-scaling of pills use the same rules as the whole pass. No output, golden, deadline, tolerance or budget changes. The generated skill viewer is refreshed.

## Attribution

The Follow failure (`keep-camera.spec.ts:264`, Dev server) is a whole-test deadline, not framing: in the failing trace every framing step had succeeded and the deadline arrived as the Follow menu opened. #429 lengthened the test's playback from 4.5 to 6.5 simulated seconds (the upgraded example narrates "Doors open" at 6 s), and the example's new callers made each Live frame heavier (call pills, thread meters, cache readouts and the engine's call accounting).

Linux container, Dev server, one worker on two CPUs (Black Friday doors-open):

|                       | `11839fab2` (before caching) | `9fe20e3aa` | This change |
| --------------------- | ---------------------------- | ----------- | ----------- |
| 4.5 simulated seconds | 1.94 s                       | 2.81 s      | 2.23–2.27 s |
| 6.5 simulated seconds | 2.78–3.19 s                  | 4.30 s      | 3.38–3.45 s |
| Whole Follow test     | 8.4 s                        | 11.4 s      | 9.9–10.2 s  |

With Nightly's three workers on four CPUs, the Follow cases took 17.1–18.0 s at `9fe20e3aa` and 16.2–16.8 s with this change.

The low-zoom SVG export is not changed here; see `docs/backlog/2026-11-04-black-friday-dev-deadlines.md`.
