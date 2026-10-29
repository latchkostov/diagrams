## Faster PNG export on large diagrams

PNG export captures ordered computed declarations once and feeds them directly to its existing
shared-style representation. It avoids writing every declaration to each detached clone and reading
the complete block back afterward. Font discovery and image embedding retain their native resource
styles until embedding finishes; prefixed mask aliases receive the embedded URLs too.

The downloadable SVG stays on its existing path. Export progress, cancellation, peer-edit checks,
font-size adjustment, iframe display and SVG path adjustments retain their existing behavior.
No controls, tolerances, goldens or bundle budgets change. Full parity passes all 3,178 goldens
and 110 browser cases, with zero changed, added, missing or stale goldens. SVG and HTML retain
their exact comparisons; PNG uses the existing 16/255 channel threshold and min(0.1%, 600 pixels) cap.

The opt-in survey helper now measures cold PNG independently at both 500 and 1,500 nodes, using
three fresh browser contexts per size, the deterministic pipeline workload, automatic layout,
1440 × 900 at device scale one and 2× main-thread CPU throttling. Timings include download completion
and two frames; they are observations rather than test budgets. Raw evidence stays in
`tests/.output/bench/survey2/png-{before,final}.jsonl`. The baseline build is `946733c3f`;
the generated workload bytes are identical across revisions.

| Nodes | Before median (range), seconds | After median (range), seconds | Improvement    |
| ----- | ------------------------------ | ----------------------------- | -------------- |
| 500   | 13.843 (13.543–14.966)         | 11.299 (11.176–12.417)        | 18.4%, 2.544 s |
| 1,500 | 39.214 (38.470–47.015)         | 34.709 (33.626–35.447)        | 11.5%, 4.504 s |

Each cell represents three samples on Windows, Node 24.22.0, Chromium 156.0.8078.4.
The 1,500-node result clears the 10% acceptance threshold but falls short of the estimated
6–10 second saving. These are local observations, not a cross-machine latency guarantee.

An earlier prototype retained inline declaration ordering and rebuilt full CSS strings for
the sharing cache. Its 500-node median improved only 3.6%; it also left redundant shorthands
in the representation. The retained implementation captures computed declaration order, keeps
local custom properties, emits a complete rule only for the first block in each sharing group,
and releases captured records before raster decoding. SVG sharing and default-style omission
were rejected because they would change the stricter SVG contract or depend on browser defaults.

The native-write regression performs two resource writes for 103 captured declarations. Disabling
capture makes it fail with 103 writes. Separate units cover final resources, root overrides,
priorities, aliases, sharing differences, SVG fallback styles and font/iframe/path adjustments.
