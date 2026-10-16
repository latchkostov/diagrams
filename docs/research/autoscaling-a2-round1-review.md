# Autoscaling A2 review round 1 (2026-10-15)

The seven-angle code review against origin/master reported six P1 and nine P2 entries;
several described the same defect. All distinct findings are fixed. The scoped designer
follow-up found no remaining blockers after the recovery-copy correction. Its evidence
was source/tests and the Round 42 captures, not independent browser or assistive-technology testing.

| Finding                                                                             | Resolution and regression                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing bindings became unreadable after graph edits (five overlapping P1 reports) | Node, edge, metadata, deletion, reconnection and stencil transactions preflight the complete candidate, including saved simulations. Invalidating edits are refused before mutation. Flow tests cover ten edit paths and explicit disable-then-delete. Recovery copy identifies the node/saved policy to change first.        |
| Resource execution depended on an enabled controller (P1)                           | Optional `resources.modelRevision: a2` opts generic Deployments into resource execution independently of controller mode. Import and explicit lessons set it. Fixed preserves those resources; unmarked A1 behavior remains unchanged. Playback and production import tests cover disabling scaling with CPU limits retained. |
| Binding validation disagreed with inferred DLQ topology (P2)                        | Extracted the existing route classifier to the model and shared it with bindings, choices and simulation. Inferred DLQ routes cannot satisfy metric bindings; explicit `dlq: false` remains supported.                                                                                                                        |
| Fractional Capacity multiplied positive KEDA bounds to zero (P2)                    | Only authored zero stays zero; multiplied positive bounds retain a floor of one. Tests cover 0.1, 0.25 and 0.49.                                                                                                                                                                                                              |
| Imported resources escaped schema bounds (two overlapping P2 reports)               | Validate the complete resource object before returning it. Unsupported long grace periods use the importer's existing diagnostic recovery, preserving topology.                                                                                                                                                               |
| Successful cache reads untested (P2)                                                | A successful cached metric remains fixed between polls despite changing source values; an uncached trigger updates independently, then the next poll refreshes the cache.                                                                                                                                                     |
| Focus lost when source controls unmounted (P2)                                      | Accepted explicit source selection focuses Target after the commit. Production test checks the surviving field.                                                                                                                                                                                                               |
| Failed source commits silently dismissed controls (P2)                              | Retain pending controls, announce the localized validation error with an accessible status, and clear pending only after success. Production test uses the actual document lifecycle budget.                                                                                                                                  |
| Inspector graph copies and discarded validation caches (two P2 reports)             | Keep one validator per mounted inspector, memoize source choices/snapshot and reuse it for hints. Fixed/HPA never request the broker graph. A stable Canvas callback prevents draft renders from recreating the snapshot. Tests prove no Fixed/HPA graph reads.                                                               |

Rejected: silently remapping or disabling an existing scaler during a graph edit. A policy can
observe an independent broker/group, including from saved simulation patches; guessing changes
its meaning. The refusal is atomic and explains how to explicitly change/disable the policy first.
No new global controls or execution models were added. ScaledJob, generic metric queries,
SQS delayed visibility and unsupported vendor modes remain diagnosed as specified by A2.

The initial unit suite passed 7,250 tests (four existing skips). The initial requested production
browser suite passed 225 tests. The expanded 5,000-seed oracle exposed two retained-memory failures;
ready-only sampled admission clipped draining work. Exact and sampled occupancy now retain it,
and the repeated 5,000-seed run passed. Seeds 505 and 1724 are retained in the normal suite.

The review-fix focused suite passed 187 tests, followed by 107 flow tests with the recovery-copy
regression. The first browser refusal fixture used fleets above the per-node cap and did not reach
the document budget; the corrected ten-fleet fixture passed all eight KEDA browser tests.
Deliberate reversions caught seven core review regressions, all three UI review regressions,
and the recovery-copy regression. Each mutation was restored before positive verification.
The complete final suite and parity outcomes are recorded in the delivery report.

The initial parity update added 93 records and intentionally changed seven shared/import records;
see `../PARITY.md` and the release note for each reason. The independent resource revision and
recovery copy extend those same schema/skill/import/catalog records. Existing legacy/A1 diagram
outputs remain fixed; no execution golden is re-recorded to accept a failure.

Final review-fix verification: 534 unit files passed, 7,278 tests passed and four existing tests
were skipped; the complete requested production Chromium suite plus CSP passed all 226 tests
on ports 6300–6304 with three workers. A concurrent attempt had one 2,000-document import timeout
and one paused-Revive callout failure; both passed in the separate full reruns without increasing
any timeout. Full parity matched all 1,854 records (Linux browser: 52 passed, eight existing skips).
Production build, 105.7 kB gzip entry budget, i18n (zero errors) and fresh skill-viewer checks passed.
The skill plugin is 1.1.26, one patch above the current origin/master's 1.1.25.
