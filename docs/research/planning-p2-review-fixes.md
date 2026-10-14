# Planning P2: PR #101 review fixes (2026-10-14)

All nine P2 findings in review 20261014-171501 were verified and accepted. Several report the same defect.

| #   | Reviewer      | Finding                                                                | Resolution                                                                                                                                                                                         |
| --- | ------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Accessibility | Translate the no-reader rationale at presentation time                 | Neutral descriptor and deterministic English rationale; `presentFinding` translates only the displayed copy.                                                                                       |
| 2   | Architecture  | Use the effective free-play multiplier when reconstructing assignments | Assignment reconstruction reads the Inputs capacity override before the saved simulation multiplier.                                                                                               |
| 3   | Architecture  | Keep localization outside the deterministic check rule                 | Removed the rule's `t()` dependency; complete findings remain equal across English and German.                                                                                                     |
| 4   | Correctness   | Include free play's Capacity multiplier in assignment labels           | Production browser regression changes a mixed Kafka/Kinesis pool to Capacity ×4 and checks seven assigned of eight, one idle, and Shards in both badge and hover.                                  |
| 5   | Correctness   | Keep no-reader findings independent of the UI language                 | Same fix as #1 and #3; cached findings are unchanged by presentation.                                                                                                                              |
| 6   | Performance   | Avoid resolving every node's settings to identify partitioned brokers  | Catalog classification precedes settings resolution; operation count asserts zero resolutions for 256 services/subscriptions and at most two for one unraised Kafka topic.                         |
| 7   | Tests         | Cover unread subscriptions in the locale regression                    | All five fan-out stencils compare complete findings across locales and test cached presentation in German and English; browser test covers worker-produced findings.                               |
| 8   | Tests         | Assert each subscription's delivery count                              | Existing steady-state test checks both readers; finite bursts check exactly 37 messages per subscription across all fan-out stencils, no remaining work or losses, and competing queue deliveries. |
| 9   | Types         | Translate the rationale when rendering, not when checking              | Typed rationale descriptor crosses the worker boundary; detection stays language-neutral.                                                                                                          |

No finding was rejected or deferred. Expanding engine snapshots with broker vocabulary was considered but
not adopted: the existing shared assignment function already handles allocation; supplying its effective
multiplier fixes this defect without extending the snapshot protocol.

Regression probes temporarily restored the old no-reader rule and broker filter: five locale tests and
the settings operation-count test failed. Restoring old badge multiplier and presentation code made both
new production browser regressions fail on the wrong broker noun and English rationale respectively.
Temporarily suppressing the second subscription's delivery made all five finite fan-out tests fail with
`[37, 0]` instead of `[37, 37]`. All deliberate mutations were restored.

Validation: `pnpm test` passed 5,903 tests with four skipped; the operation-count test also passed after
relaxing its bound to allow future reductions in work. Production Chromium covered live, capacity, all
four checks specs, sim-truth, planning-p1, planning-p2 and i18n on ports 6140–6149. The first full run had
204 passes and one new assertion failure caused by an omitted colon in the expected English label.
After correcting that expectation, all 20 P2 tests passed; both changed-state tests passed again after
the deliberate browser regression probe. Initial lint caught two non-null assertions in the new browser
fixture; these were replaced with property updates and the changed-state tests passed again.
No product failure remains. Every server was stopped.

`pnpm build`, `pnpm size`, `pnpm i18n check` and `pnpm skill:check` passed. Existing missing-translation
and translation-review warnings remain. The stale agent viewer was refreshed with `pnpm skill:release`,
then the plugin version was kept exactly one patch above master at 1.1.15. Master had not moved, so no
rebase was needed. Final lint, typecheck and format checks run immediately before the signed commit.
