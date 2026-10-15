# Autoscaling A1 round 3 review dispositions

Review: `.reviews/20261015-071246/REPORT.md`, seven P1 and six P2 findings. Rebased this
worktree onto `origin/master` with #119, then ran `pnpm install` using Node 24 and pnpm 12.
Both release-note sides were retained. Master owns the lockfile and E2E timing records.

All thirteen findings are confirmed; none is rejected. The repeated validation findings describe
related defects and share one persisted-resource boundary rather than independent implementations.

| Finding                                            | Disposition and regression                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 architecture: all node-creation paths           | One editor transaction preflights and rechecks queued additions together with their edges. Tests cover add, named/rail/connected creation, edge insertion, connected cloning, paste and duplicate, including queued additions with reserved IDs. Full-document imports, agent operations and templates retain native validation before replacement. |
| P1 architecture: native/editor validation mismatch | Native reads and editor commits use `createResourceValidator`, sharing revision eligibility, persisted resource/policy schemas, cross-field constraints and document budget. A spy proves both paths construct the same validator. Agent null deletion commands are already removed by `mergeProps`; persisted null is rejected.                    |
| P1 correctness: Capacity × saved twice             | Apply incoming multiplier before any reconciliation, then reconcile each changed fleet once with its final policy. Engine and real LiveController save tests advance time first and preserve desired/ready/starting counts.                                                                                                                         |
| P1 correctness: lifecycle pause deadlines          | Record pause time and shift startup, exact drain, sampled drain and sampled work-part deadlines on exit. Tests check startup created before or during pause through checkpoint restore and compare draining at scales 1 and 10 with an unpaused baseline. Controller sync retains its existing resume scheduling.                                   |
| P1 performance: graph validation per keystroke     | Cache immutable resource/policy identities per node and budget inputs. Twenty edits among 1,000 services make zero schema, budget or graph-conversion calls after warmup; changing one resource object makes one schema and one budget call.                                                                                                        |
| P1 security: A1 edits in older revisions           | Every candidate checks eligibility; unmarked legacy clipboard JSON with resource settings is rejected. Tests cover p1, p2, p3 and revision-free documents.                                                                                                                                                                                          |
| P1 types: persisted null resources/policy          | Both null values are rejected before commit; undefined deletion is normalized and remains valid when reopened.                                                                                                                                                                                                                                      |
| P2 accessibility: silent paste refusal             | Existing translated compatibility guidance now offers the upgrade preview. Unit and production-browser tests verify refusal, action, focus and one-time request consumption.                                                                                                                                                                        |
| P2 accessibility: shared disclosure boolean        | Explicit A1/legacy preview state switches or toggles the requested disclosure. Each control has its own expanded state and target. Browser regression switches in both directions and closes the active preview.                                                                                                                                    |
| P2 performance: starting-cohort scans              | Maintain an ID-ordered lifecycle index with prefix ranks. Paging locates its rank directly and visits at most fifty cohort/index entries, including after partial readiness and cancellation. Restoring the old page loop performs 760,000 reads and fails the same assertion.                                                                      |
| P2 security: live override allocation              | Engine and LiveController preflight complete proposed properties and capacity before mutation. An eleven-service batch requesting 10,000 jittered replicas each is rejected with snapshots, inputs and effective settings unchanged.                                                                                                                |
| P2 tests: playback depends on readiness            | Seed playback paused, settle and pause the page clock, then Play. A regression advances thirty page-clock seconds before Play and still checks the same starting/ready boundaries.                                                                                                                                                                  |
| P2 tests: memory and absolute targets unexercised  | Direct runtime controller tests assert metric value, raw recommendation, desired count and binding resource: memory beats low CPU at scales 1/10, and four replicas averaging 500m need eight at a 250m absolute target without a CPU request.                                                                                                      |

## Verification

Node negative controls temporarily restore pre-fix sources and require the new regressions to fail.
Metric negative controls disable memory and averageValue handling. Browser negative controls restore
pre-fix disclosure/paste code and remove paused startup. Every temporary change is restored.
The required designer review caught a persistent upgrade focus request; it was consumed once and
re-reviewed successfully, with a browser revisit regression. No global controls were added.

Final verification:

- `pnpm test --maxWorkers=2`, using the repository's full default configuration: 6,568 passed,
  four skipped, 502 test/typecheck files passed. No type errors under TS 7.
- Production Chromium E2E on ports 6230–6234: all 129 tests in autoscaling, live, sim-truth,
  planning-p1/p2/p3 and capacity passed. After the final lifecycle/index refinements, all fourteen
  autoscaling tests passed again on a fresh production bundle. Playwright stopped its servers.
- Negative controls: restoring the pre-fix sources failed 25 node tests; disabling memory and
  absolute-value handling failed all three metric tests; restoring the old page loop performed
  760,000 cohort reads against a fifty-entry limit. Restored browser behavior failed all three new
  readiness/disclosure/paste tests. A startup requested during a pause also failed its readiness
  boundary before using the frozen clock. All temporary mutations were restored.
- `pnpm build` and `pnpm size` passed: entry 104.0 kB gzip against a 123.5 kB budget. The startup
  contract explicitly includes shared configuration validation; execution remains lazy.
- `pnpm i18n check`: zero errors, with existing missing-translation/glossary warnings. No new messages.
- `pnpm parity`: all 1,552 goldens matched, including 875 Node checks and 46 browser checks in the
  pinned Linux Playwright Docker image. No golden changed, was added, went missing or became stale.
- `pnpm skill:check`: the released viewer matches a fresh build. Plugin 1.1.20 is exactly one patch
  above `origin/master`'s 1.1.19.

The initial full run alongside browser builds had eight failures: stale generated skill code and
its new startup chunk pin, plus five timeouts and one complexity-ratio failure in unchanged engine
and infrastructure tests. The generated code/pin were corrected; isolated full reruns passed without
changing those tests or their timing rules. Early new-fixture failures were corrected before their
negative controls. The closing lint gate caught a non-null assertion in the browser fixture;
it was replaced with an explicit guard. Format check also caught the plugin manifest's line endings,
which were normalized without changing its version.

Lint, typecheck and formatting run after this final record and immediately before the signed commit.
No golden was re-recorded to hide a failure.
