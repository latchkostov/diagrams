# Autoscaling A1 review dispositions — 2026-10-14

`pnpm review --since origin/master` ran all seven repository review angles. Its 19 entries contained
duplicates across architecture, performance and types: 0 P0, 9 P1 and 10 P2. All actionable findings were
accepted; no finding was dismissed or deferred.

| Issue                                                   | Resolution and regression                                                                                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jitter permanently fragments sampled CPU work           | Compact ready ranges while retaining occupied CPU boundaries; 1,250/10,000-replica cohort assertions.                                                     |
| Lifecycle allocation amplification                      | Cap effective fleets at 10,000; reject authored document ranges above 100,000 before allocation. Native/engine hostile-input regression.                  |
| Repeated resume and unchanged authored replicas         | Consume commands before property deduplication; never retain resume as engine state. Repeated override/resume, exact first-sync and Save ownership tests. |
| Malformed editable resource objects crash the inspector | Validate before reading nested fields; preserve a recoverable preset control and diagnostic. Server-render regressions for both malformed objects.        |
| Sampled log CPU borrows idle HTTP replicas              | Bind broker work to its own partition allocation while retaining the shared CPU budget. Exact/sampled mixed-input throughput comparison.                  |
| Removing resources leaves drain reservations            | Clear incoming groups' drain ownership when the fleet is removed; assert restored partition assignments.                                                  |
| Down-arrival retained retries lack ownership            | Reserve exact/cohort ownership before retaining and gate retention by available resource slots. Exact and sampled outage/recovery regressions.            |
| History objects copied every animation frame            | Cache detached frozen history until its next publication; assert cache reuse, immutability and old-snapshot isolation.                                    |
| Resource edit comparison is quadratic                   | Index previous nodes once; actual graph reads grow below 24× for an 8× input increase.                                                                    |
| Numeric input rejects incomplete values                 | Keep local drafts and commit valid values on blur; real sequential keyboard entry and Undo regression.                                                    |
| Pagination contrast                                     | Reuse themed buttons; dark-mode axe coverage with 60 replicas and an enabled next page.                                                                   |
| Missing decision announcements                          | Selected-node polite status includes name, desired/ready count and reason; metric-only refreshes keep the announcement unchanged.                         |
| Missing-metric safety masked by stabilization           | Fresh fleet with zero down-stabilization, plus a valid growth metric alongside a missing metric.                                                          |
| Resume test only compared replay with itself            | Assert held count, suspended decision time and the first resumed sync, then checkpoint/restart equivalence.                                               |
| Idle complexity test counted calls, not work            | Count actual fleet reads through engine stepping/readouts and compare whole-engine same-run growth. A per-replica traversal fails the regression.         |

Additional checks cover metric window plus delay fitting the bounded history, unbounded CPU labels,
atomic Advanced JSON replacement, retained invalid drafts, observed peak labels and presentation handles.
Targeted mutation runs restored the faulty implementations individually and confirmed assertion failures,
then restored the fixes. No wall-clock performance budget or arbitrary delay was used.

Validation:

- Full unit suite: `pnpm test --maxWorkers=4`, 492 files passed, 6,403 tests passed, four skipped;
  no type errors. A1 regressions cover CPU integration, deterministic burst/startup/checkpoint playback,
  stabilization, max reached, drain/grace, partition idleness, managed allocation and bounded engine work.
- Production Chromium: all 238 requested live, capacity, checks, sim-truth, P1/P2/P3, i18n and A1 cases
  passed. After the final rolling-chart correction, all six A1 cases passed again against a fresh build.
  Ports were explicitly 6230–6234, with `E2E_TARGET=build` and `VITE_E2E=1` test hooks. Round 39 contains
  the final synthetic screenshots and designer gate.
- All 17 public-example finding lists, targets and severities are unchanged, including explicit A1 upgrades.
- `pnpm build`, `pnpm size`: pass; entry 103.9 kB gzip against the unchanged 123.5 kB budget.
  Startup validation chunks and the two canvas chunks remain pinned.
- `pnpm schemas` refreshed agent operations/schema. `pnpm skill:check` matches the refreshed viewer;
  plugin 1.1.19 is exactly one patch above origin/master's 1.1.18.
- `pnpm i18n check`: zero errors and zero stale translations. All new messages have all 37 translations;
  the existing 77 missing messages per locale and glossary warnings remain.
- Final pre-commit gates are `pnpm lint`, `pnpm typecheck` and `pnpm format:check`, after the final edit.

Earlier failures are retained in local logs. The first post-review unit run caught the newly introduced
startup validation chunk, now explicitly pinned. Default-worker full runs hit six dynamic-import timeouts
and a cascading worker assertion; a concurrent run also exceeded an existing import-layout growth ratio.
The complete four-worker run passed with unchanged timeouts and growth limits. Deliberate mutations
failed as intended, including removal of HPA evaluation and per-replica idle traversal. An initial axe-only
pagination check missed the faulty contrast; the added measured contrast assertion catches that mutation.
No failure remains in the final unit and production-browser runs.

Final lint caught an unused literal label in the new server-render fixture; the fixture now has an empty
child. The focused fixture tests passed again. Format preflight also normalized one stylesheet's line endings.
