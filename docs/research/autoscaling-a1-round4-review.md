# Autoscaling A1 round 4

Review: `.reviews/20261015-113727/REPORT.md` (six P1, seven P2).

## Fixes and guards

| Finding                                   | Change                                                                                                                                                                   | Regression                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| P1 bulk HPA guard / P2 shared eligibility | Property-aware `nodeSimFields` is shared by single/bulk inspectors, including mixed selections.                                                                          | Field-rule unit test; edit/live mixed-selection production browser tests.                                                                  |
| P1 retry refusal leaks reservations       | Release resource ownership before removing a refused in-place retry.                                                                                                     | Retry refusal/recovery test with the invariant checker enabled.                                                                            |
| P1 queued resource cleanup                | One work iterator covers working, pending and staged attempts; common cleanup clears obsolete CPU/deadline/identity state.                                               | Enable resources into a smaller busy fleet, disable them, then drain every attempt.                                                        |
| P1 memory final quantum                   | Capture interval occupancy before completed attempts release ownership.                                                                                                  | A saturated 10 ms service reports memory pressure and grows.                                                                               |
| P1 sampled CPU multiplication             | Run-wide shared part budget preflights admissions and drain splits, including work in other fleets; checkpoints preserve the shared counter.                             | Partial jittered 10,000-replica startup, 200 sampled attempts, allocation counts/recovery; scripted controller refusal/checkpoint/restart. |
| P1 fractional downscale                   | Round removals up, equivalently rounding remaining replicas down.                                                                                                        | 3→2, policy-period hold, then 2→1.                                                                                                         |
| P2 persisted revision schemas             | Persisted NodeProps reject A1 properties before p3-a1; V2 constrains legacy nodes and simulation patches separately. General patch schemas keep A1 support.              | Schema/native reader agreement across v1 and every V2 revision, nodes/setup/timeline.                                                      |
| P2 retry CPU backoff on resume            | Common deadline shifting handles CPU backoff and retry admission together.                                                                                               | Exact/sampled paused retry tests and temporal invariants.                                                                                  |
| P2 metric window scans                    | Cache raw aggregates by publication and exact entry/expiry boundary; divide by current fleet/request values when reading.                                                | Count history reads over 60 frames; denominator/publication changes; non-second publication boundary.                                      |
| P2 readiness index rebuild                | Readiness only visits due cohorts and marks the selected-replica index dirty. Coalesce rebuilding at page requests; defer range compaction until needed/final readiness. | Count zero full-index maps and zero ready-range reads during partial jittered startup; cached pagination regression.                       |
| P2 ineffective delay test                 | Historical and recent CPU samples now differ.                                                                                                                            | Historical metric 10/raw 1, then delayed new metric 200/raw 6.                                                                             |
| P2 React budget exceptions                | Catch capacity-input refusals before notifying listeners of a successful edit; render an in-place alert.                                                                 | 25 fleets at the limit: refuse 1001, reopen at 1000, recover at 999, no browser errors.                                                    |

Each focused regression was tested with the corresponding fix temporarily removed. All 13 unit
mutations were caught (the shared HPA finding has two review entries); removing the bulk call-site guard
and React catch caused all three new production UI regressions to fail. Separate negative controls
also caught the scripted refusal notice, the between-publication CPU readout mismatch, and an unapplied
HPA shrink being recorded in policy history. Restored tests pass.

## Additional fuzzer-found bugs

- **Seed 3, scale 1:** enabling resources on a paused service created a Fleet with `paused=false` and
  no `pausedAt`. Resume shifted subsequent deadlines from time zero instead of resource enable time.
  The reduced sequence pauses, disables resources, then re-enables them. `initializeFleet` now inherits
  the node pause state and current simulation timestamp. A focused test grows a newly enabled paused
  fleet and proves precisely 100 ms of startup remain after resume. Removing this fix fails both that
  regression and the seeded pause-clock invariant.

Deliberate reintroductions also prove the randomized guard itself catches review bugs: retry release
fails seed 12 (orphan reservation), queued cleanup fails seed 16 (disabled resources own work), CPU
pause shifting fails seed 9 (lost paused backoff), and paused fleet initialization fails seed 3.
These are negative controls, not additional newly discovered bugs.

The first 200 cases and extended run are recorded below with final validation. The oracle runs after
**every** internal step, includes staged work, and checks temporal retry preservation as well as static
state. Failures retain explicit deletions in their printed reproductions. Reduction is 1-minimal over
events, with unneeded diagram nodes removed.

## Additional production E2E finding

The first full production browser run passed 132 tests and failed the existing exact-replica CPU
comparison: aggregate CPU read the last UI publication (75%) while replica rows read the newer engine
clock (80%). Resource-enabled inspector observations now read the same current cached snapshot as
replica rows when no frozen observation is explicitly supplied. A deterministic component regression
advances the engine from 4 s to 5 s without publishing and compares both rendered readings. This was
found by E2E, not the fuzzer, so it has no random seed.

## Choices and rejected alternatives

- Keep the existing exact/sampled execution model. An unconditional attempt-by-ready-range product
  was rejected: both input budgets independently allow a hostile cross-product. A shared 20,000-part
  cap bounds that product before allocation; it defers admissions/split-causing shrinks while already
  admitted work progresses. This is backpressure with recovery guidance, not silent message loss or
  an uncaught playback exception. The bound is shared across fleets and included in checkpoints.
- Do not raise runtime/test budgets or rewrite simulation goldens to hide failures. Operation counts
  guard the performance fixes; changing samples guard delay semantics.
- Keep the existing translated lifecycle-budget copy in this batch. The required designer-agent UX
  review passed; its optional suggestion to simplify that existing copy is deferred to a consistent
  translation update. The new CPU refusal message uses ordinary language and the existing notice area.
- No new chrome or showcase is necessary: this batch fixes existing A1 behavior, and its existing
  public showcase still demonstrates readiness, backlog drainage and replica history within ten seconds.

## Parity

Three intentional shared golden changes: `node/skill/public-schemas.json` (revision-aware diagram
v1/v2 contracts) and `node/i18n/catalogs.json` (one A1 recovery message, per-language counts/fallbacks and
autoscaling-area hashes), and `node/skill/current-stencils.json` (the current generated usage ranking
combining the existing A1 showcase with the six showcases added on master). Every diagram output and every browser golden remains unchanged, including
all A1 histories and non-A1 outputs. See `docs/PARITY.md` and the release note.

The final budget-path audit additionally verifies that a refused HPA shrink keeps the fleet's actual
desired count in its decision and removes the unapplied delta from rate-policy history. Once room is
available the next sync applies and records the shrink exactly once. This guard-path regression was
also confirmed by temporarily removing the fix; it is not a fuzzer-found bug.

## Rebase integration

Rebased the four existing A1 commits onto master's two new commits (nightly reliability and six public
showcases). Both sides of documentation conflicts are preserved. Legacy migration gates now exclude
both p3 and p3-a1 documents; draw.io round-trip expectations retain A1's required revision while keeping
master's explicit older-model loss. The existing aggregate skill cohort stays frozen at its 18 inputs
(including the previously committed A1 example), and the six new showcases retain individual coverage.
The current stencil reference is regenerated from all 24 examples. No diagram output golden changes.
The first post-rebase unit run caught the draw.io expectation integration mismatch; it passed 6,902
other tests with four skipped before that expectation was reconciled.

## Validation

The initial unrestricted full unit run
had two unrelated import timeouts and one checks-sanitizer complexity-ratio failure (5.25 versus <4);
6,797 tests passed and four were skipped. Those failures are reported rather than hidden. Initial new
bulk browser tests also exposed test setup mistakes (covered node/collapsed inspector), corrected by
selecting the test's two workers before entering Live; the corrected tests passed before mutation.

A later concurrent unit/parity run had one unrelated Strimzi index growth-ratio failure and another
Draw-everything import timeout (6,901 passed, two failed, four skipped). The final full unit run used
one worker and the repository's existing CI hang backstop; no assertion threshold or timeout
configuration was edited. Pre-rebase reruns were intentionally stopped when master advanced.

| Final validation                      | Result                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CI=true pnpm test -- --maxWorkers=1` | 508 files passed; 6,905 tests passed, four skipped.                                                                                                                            |
| Ordinary seeded invariants            | 200 seeds, every internal step; included in the full suite.                                                                                                                    |
| `A1_FUZZ_NIGHTLY=1` invariant run     | 5,000 seeds passed; configured in nightly.                                                                                                                                     |
| Required production Chromium E2E      | 133 passed; autoscaling, live, sim-truth, planning-p1/p2/p3, capacity; explicit ports 6230–6234.                                                                               |
| `pnpm build` and `pnpm size`          | Passed; entry 104.0 kB gzip, budget 123.5 kB (84%); no budget change.                                                                                                          |
| `pnpm parity`                         | All 1,761 goldens match: zero changed, added, missing or stale; 50 browser cases passed, eight existing master deferrals skipped.                                              |
| `pnpm i18n check`                     | Passed, zero errors; missing-translation/fallback warnings remain, including the new A1 message's English fallback.                                                            |
| `pnpm skill:check`                    | Fresh released viewer; marketplace version 1.1.21, exactly one patch above origin/master's 1.1.20.                                                                             |
| UX gate                               | Required designer-agent source review passed, including refusal notice and CPU readout coherence. Production accessibility/layout assertions passed in the required E2E specs. |
| Final commit gate                     | `pnpm lint`, `pnpm typecheck`, `pnpm format:check` run last; the signed commit is conditional on all three passing.                                                            |

All servers started for validation were stopped. The branch was rebased onto `54581b0` before the
final validation. No PR was opened and no merge was performed.
