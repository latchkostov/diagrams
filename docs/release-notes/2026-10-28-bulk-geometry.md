## Bulk geometry preparation

Auto-layout and Paste share canvas preparation instead of rediscovering unchanged geometry.
Animation discovery visits floating overlays, caches its results while measurements are pending,
and refreshes them on the confirming sample so a new programmatic entrance still holds the fit.
Removing an overlay releases its cached animations. Live size checks, delivered ResizeObservers,
fonts, final routes and the camera's measured refinement remain required.

A canvas-local geometry revision coalesces equivalent store publications across readiness, frame
decoration and identity. Unchanged card boxes, identity metrics, labels and region-title inputs are
reused. Region chips read their sizes together and own their portal's placement; mounting that portal
does not prepare the whole scene again. Region placement waits for the camera's readiness phase.

## Measurement

Same-worktree Windows Chromium 156, Node 24.22.0, 1440 × 900, one worker, 2× main-thread throttle.
The survey's unchanged 500/1,500-node pipeline, three fresh-context samples per action and size;
layout includes the same one-second quiet observation, and Paste adds exactly 50 nodes to Overview.
Unprofiled observations are compared separately from diagnostic traces. This is a local comparison,
with other desktop activity possible, rather than a controlled CI prediction.

Baseline medians (observed range), milliseconds:

| Action      |           500 parts |         1,500 parts |
| ----------- | ------------------: | ------------------: |
| Auto-layout | 3,430 (3,331–4,644) | 5,708 (5,539–5,904) |
| Paste 50    | 2,765 (2,699–3,632) | 6,863 (6,765–6,999) |

The PR records final measurements and verification. The comparison workflow retains both revisions'
complete raw survey sample groups for review.

The opt-in survey helper records preparation counter deltas per action from `data-geometry-work`:
readiness, frame and identity passes, geometry measurement groups/cache misses, revisions and animation
discoveries. Counters do not add a production UI surface. Unit tests also count native reads and
reservation calls, and deliberately reverted implementations must fail the regressions.

## Rejected approaches and output contract

The initial scoped-animation/cache prototype did not establish a greater-than-10% improvement at
1,500 parts. It was not treated as acceptance evidence. Subsequent tracing identified premature
region-title preparation, an unused canvas rectangle read and synchronous early-fit pane reads.
A scoped pane/chrome borrowing prototype was rejected because its observed action-level benefit
was below 10%. Readiness timeouts, budget/reserve increases, weakened assertions and golden updates
are excluded.
No output golden is intended to change; acceptance requires the complete parity suite unchanged.

## Verification

The complete parity run preserved all 3,178 goldens: zero changed, added, missing or stale. Targeted
unit guards pass, and deliberate removal of the preparation fixes fails their regressions. Production
build, entry size and fixed canvas/Live reserve checks pass. The initial Live reserve failure was
resolved by stripping diagnostic counters from production builds; no budget or reserve changed.
The regenerated skill viewer is included. Local timing groups that overlapped another browser
benchmark are excluded from acceptance; use the PR's same-job comparison and raw artifacts.
