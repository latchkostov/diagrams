# Planning P3 final review dispositions

Review: `.reviews/20261014-195734/REPORT.md`, 2026-10-14. All 6 P1 and 11 P2 findings
are accepted. Repeated findings below identify the same defect and share its regression.

| Finding                               | Disposition and evidence                                                                                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 architecture: shared normalization | `normalizeCall` in admissionPolicy supplies both planning and playback with costs, quotas, scopes and concurrency requirements. Duplicate definitions fail validation rather than picking a winner.                                                                                               |
| P1 correctness: fixed fleets          | Allocation stays independent of multiplied, partition-assigned fleet capacity. Tests cover Capacity × 0.5 and × 2, Save parity, planning, and scalar concurrency edits.                                                                                                                           |
| P1 performance: checkpoints           | Only mutable buckets and reservations enter admission's checkpoint graph. Restore rebuilds indexes and requirements against the restored policies. A clone-boundary test checks the exact mutable fields, plus restore after an intervening policy change.                                        |
| P1 security: timeline recompilation   | Scalar replicas, concurrency, allocation and scaling edits retain immutable requirement identities. Identical scalar patches skip resolution. An accepted 1,000-step time-zero timeline with 500 endpoints and 32 quotas counts validation and normalization work, independently of elapsed time. |
| P1 types: namespace collision         | Local identities have an explicit local tag, separate from shared identities. A validated node/allocation ID collision enforces both limits in playback and planning.                                                                                                                             |
| P1 types: unique quota IDs            | Model validation rejects same-ID quotas within either node or endpoint scope, with a clear quota-ID error. Runtime resolution fails closed too.                                                                                                                                                   |
| P2 accessibility: row selection       | Managed services are filtered before ranking, limiting and counting hidden rows. Four/five managed services cannot hide an editable service or manufacture Show all rows.                                                                                                                         |
| P2 accessibility: zero capacity       | The chip describes rejected traffic; the headline says every call is rejected, and the detail names the concurrency or quota budget.                                                                                                                                                              |
| P2 architecture: bulk applicability   | Single and bulk managed editors share field bindings and property mappings. Automatic functions hide fleet controls; model APIs expose admission controls. Per-node patches preserve distinct account references, costs and quotas in one state pass/undo step.                                   |
| P2 architecture: validation boundary  | The model owns admission shape and identity checks. A headless test makes importing the native adapter throw, then resolves valid/invalid policies successfully without it. Browser build grouping preserves the existing startup chunk list.                                                     |
| P2 correctness: duplicate quota IDs   | Same defect as P1 quota uniqueness; both import and runtime regressions cover it.                                                                                                                                                                                                                 |
| P2 correctness: identity collision    | Same defect as P1 namespaces; the valid opaque-ID regression covers it.                                                                                                                                                                                                                           |
| P2 correctness: zero-duration calls   | A positive offered call with zero local, endpoint, shared or fleet concurrency has zero capacity regardless of latency. All four scopes are tested against playback.                                                                                                                              |
| P2 performance: endpoint index        | Declarations are indexed once; incoming rates are aggregated by endpoint before interpreting budgets. A 10,000-call / 500-endpoint test counts array reads.                                                                                                                                       |
| P2 security: identity collision       | Same defect as P1 namespaces, including independent local and shared accounting.                                                                                                                                                                                                                  |
| P2 tests: caller boundary             | Parameterized native and generated skill tests reject negative deadlines, zero connection/attempt limits, and invalid retry strategies/statuses; a complete valid policy round-trips unchanged.                                                                                                   |
| P2 tests: document shared quotas      | Two callers share the document's matching budget in planning/playback. Changing only the document definition rejects before charging. Matching parent/endpoint references charge once.                                                                                                            |

No finding was rejected. Alternatives declined: first/last-wins duplicate normalization silently loses
constraints; retaining compiled checkpoint graphs multiplies immutable data; revalidating endpoint
policies for scalar fleet edits repeats unrelated work; adding bulk fleet controls for model APIs
exposes settings the simulator ignores. Lowering legitimate file limits was unnecessary for the
reported scalar-timeline amplification; work is bounded by timeline steps plus initial policy size.

## Regression verification

Each distinct defect was deliberately reintroduced, then restored. Focused tests caught namespace
collisions, quota duplicates, the original fleet ceiling, compiled checkpoint cloning, scalar policy
recompilation, zero-duration concurrency, repeated endpoint scans, filtering after row limiting,
waiting copy for rejected calls, legacy managed fields, lost per-node admission mappings, ignored
document definitions, missing native caller validation, and the native-adapter dependency.
The production browser regression also fails with bulk admission wiring removed. The failed mutation
runs are expected regression evidence, not failures of the restored code.

## Verification

- Focused admission, field-applicability, capacity-model, headless-boundary and generated skill checks pass.
- Full unit suite: `pnpm test --maxWorkers=3`, 486 files passed, 6,303 tests passed, four skipped;
  no type errors. The startup chunk list and two canvas chunks remain pinned without increasing their budgets.
- Production Chromium: all 241 requested cases are covered. The broad run passed 239/241; after
  correcting the new fixture/test interactions, the complete P3 rerun passed 16/16. Ports were
  explicitly 6150–6154 (`E2E_TARGET=build`, production e2e bundle with `VITE_E2E=1`). Playwright
  stopped its servers; no listener remained on 6150–6159. Bulk screenshot review at 1280 × 800
  shows applicable fields and actions fitting the existing inspector without overlap or added chrome.
- `pnpm build`, `pnpm size`: pass; entry 103.9 kB gzip against a 123.5 kB budget.
- `pnpm i18n check`: zero errors; existing missing-translation/glossary warnings remain, with English
  fallback for the four added messages. `pnpm skill:check` matches the refreshed viewer.
- Final pre-commit gates are `pnpm lint`, `pnpm typecheck`, and `pnpm format:check`, after the final edit.

Earlier failures are retained in the local logs: the initial full unit run caught changed startup
chunks, fixed with explicit browser grouping; a concurrent run suffered five unrelated timeouts and
one cascading worker assertion (all pass in the isolated full run). The new browser tests initially
used a fixture missing its preset revision, then incorrectly expected focused-input Undo and a click
on an already selected node to perform canvas Undo/single selection. The corrected tests use the
app's Undo action and assert restored saved values. Final lint also caught two non-null assertions in
the new browser storage polls; explicit null fallbacks replace them. No unresolved failure remains
in the final runs. Format-check also normalized five touched files before the final gates.

Rebased onto origin/master `cc705431af5ad75bbaf12712badc38cb7971affe`, retaining both release-note
entries. The refreshed plugin remains 1.1.18, exactly one patch above master's 1.1.17.
