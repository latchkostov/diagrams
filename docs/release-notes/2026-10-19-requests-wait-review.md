## Requests that wait: review fixes

Non-blocking requests free execution threads while retaining request memory and API, endpoint and shared
concurrency reservations until completion. Reply continuations reserve execution capacity without charging
request quotas again. Mixed blocking/non-blocking fan-out preserves sampled residence, including pause/resume.
Planning uses separate thread-hold and memory-residence durations, rounds combined reply handling to the
playback clock, and includes connection pools when sizing broker consumers. Fractional connection-pool entries
are rounded before saving.

The trouble fix, connection menu and Inspector edit the effective caller policy in the active saved simulation
override as one undo step. An unsaved override that cannot be edited there withholds the action. Unsupported
caller roles hide reply handling. Active call pills avoid node bounds, connection labels and other pills;
inactive requests mount no pills. Hover details reuse the effective diagram and waiting plan. Custom injection
owns a modal frame, focus and Escape cancellation while its code loads, using the same anchored frame as the
ready dialog.

## Output parity

Exactly 16 W1 goldens intentionally change: both `node/planning/<name>.json` and
`node/agent/describe/<name>.json` for each name below. The agent records' text and focused text mirror their
structured explanation. `holdMs` becomes `threadHoldMs`, and `memoryResidenceMs` records the separate lifetime:

- `blocking-call`: both durations remain 260 ms in editing and its blocking simulation.
  The saved freed-thread simulation has a 20 ms thread hold and 270 ms memory residence;
  its planned memory peak rises from 160 to 222.5 MiB to include off-thread calls.
- `corpus-w1-blocking`, `corpus-w1-held-drain` and `corpus-w1-sampling`: both durations remain 260 ms for
  blocking calls, including both of the sampling record's saved simulations.
- `corpus-w1-inflight-cap` and `corpus-w1-nonblocking`: thread hold stays 20 ms; memory residence is 270 ms.
- `corpus-w1-join-failure`: both durations remain 510 ms.
- `corpus-w1-loop`: both durations are unbounded, preserving the refusal of a finite capacity estimate.

All pre-W1 goldens, simulation/playback records, browser layouts, images and exports remain unchanged.
No output is re-recorded to conceal a failure.

## Verification

Each P1 regression fails against c45bcba9, including the production-browser override and fractional-input
tests. Negative controls also reproduce the P2 UI/cache regressions and independently reject zero reply CPU.
The targeted simulator/property run passes 482 tests; production browser coverage passes 65 tests across
requests-wait, lazy-loading and live. Build, startup chunk contracts, entry size and i18n validation pass.
The first complete unit run exposed a bundle-boundary regression and line-ending-sensitive source check;
both are corrected and their targeted checks pass. Final gate results are reported with the pushed commit.
