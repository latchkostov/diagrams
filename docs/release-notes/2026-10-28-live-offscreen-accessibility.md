## Current accessible Live readouts

Off-screen processor, gateway, source and sink readouts now update their accessible text and
thread-meter values on every Live publication. A screen reader's virtual cursor receives current
values without moving focus or the viewport. A small imperative path diffs ARIA labels and meter attributes;
visual badge rendering still waits until the card approaches the viewport. No layout reads or
per-badge React renders are added to this path.

Broker hover details reuse the parent's cached topology and memoize consumer-group names by diagram, node and role.
The focused Live benchmark now honors quick mode, `BENCH_SIZES` and report-only gates mode.
Capture coverage checks that the latest off-screen visual badge is committed before capture
returns, rather than checking only a callback.

## Output parity

Changed goldens: none. Simulation, drawing, export and planning output remain unchanged.
Budgets and reserves remain fixed.

## Validation

All regressions were mutation-checked: removing the semantic subscription, synchronous capture,
shared topology, benchmark size/mode selection, late-label observation or publication cache fails
its targeted assertion. The final Live/touched/benchmark and reserve tests passed 883 cases;
the skill heavy tests passed 175. Full parity passed 3,178 goldens with zero changed, added,
missing or stale goldens. Linux checks passed the named Live/a11y/viewport specs twice (220 cases),
with 102 further passing cases for the final ARIA-label version. No failures or flakes remain.
Build, size, skill freshness and i18n validation passed; generated viewer output is refreshed.

## Measurements

Windows Chromium 156, production E2E timing build, pipeline workloads, 1440 × 900 and 2×
main-thread CPU throttle. Three consecutive five-second steady samples after standard warm-up;
Chrome traces are collected separately. No concurrent local gate or test run during measurement.

| Nodes | Main-thread ms/frame samples | Median ms/frame |
| ----: | ---------------------------- | --------------: |
|   500 | 12.639, 11.963, 6.275        |          11.963 |
| 1,500 | 80.624, 65.345, 41.736       |          65.345 |

The 1,500-node median remains below the requested 100 ms ceiling. Raw samples retain the
warm-up drift rather than hiding it. Timings are report-only; unit tests guard operation counts.
The focused harness and raw results/traces remain in the ignored benchmark output directory.

## Rejected approach

Updating visually hidden summary text nodes still incurred rendering work: the prototype's
1,500-node samples were 153.263, 140.259 and 124.897 ms/frame (median 140.259). Replace those
summary text writes with a named accessibility group and a current meter. Repeated store/DOM
notifications reuse the publication's formatted values. Visual badge rendering stays deferred;
focus-only refresh would still miss virtual-cursor reads. Budgets and reserves are unchanged.
