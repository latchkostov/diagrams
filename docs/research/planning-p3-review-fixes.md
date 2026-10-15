# Planning P3 review fixes (2026-10-14)

Review: `.reviews/20261014-192423/REPORT.md`, PR #105. All seven P1 and ten P2
findings are accepted. The namespace and implicit-allocation code findings each overlap
with their respective coverage findings; both the defect and missing regression are fixed.

| Finding                                           | Disposition and regression                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 correctness: managed consumer partition limits | Hold each delivery's group slot before reserving admission. Prefetch stays staged and starts through admission when the slot frees. A one-partition/eight-partition Kafka fixture verifies one execution on the small input and eventual draining.                                                                                          |
| P1 correctness: fixed fleet Save                  | Fold Capacity × into replicas only for managed policies with fixed slots per replica. Replay before/after Save admits four of eight calls and keeps the independent allocation at 100.                                                                                                                                                      |
| P1 performance: property updates                  | Preserve resolved policies for unrelated properties, index definitions and references, and invalidate affected policies only. A local edit has a constant serialization count independent of the other managed nodes. Controller setup/reconciliation updates are batched; reverting batching produces two reconfigurations instead of one. |
| P1 security: unrelated timeline patches           | Same policy invalidation fix. A simulation with 500 managed endpoints and 1,000 time-zero source edits reconfigures admission only on initial load. A separate probe applies 1,024 unrelated edits with zero admission revalidation/reconfiguration.                                                                                        |
| P1 tests: quota namespace collision               | A parent 100 req/s budget and a same-ID endpoint named `global` with 2 req/s yield planning capacity two and playback two successes/one rejection.                                                                                                                                                                                          |
| P1 tests: reference-only account allocation       | Distinct policies define/reference an implicit account allocation. Two calls reserve across callers, the third rejects, release admits again; planning divides the shared capacity correctly.                                                                                                                                               |
| P1 types: managed Emits                           | Reuse the existing Emits editor under Advanced for processors. Production browser tests edit, clear and undo mappings on both Lambda and OpenAI.                                                                                                                                                                                            |
| P2 accessibility: invalid drafts                  | Associated status feedback explains range, step and retained setting; the draft is marked invalid while focused. Browser tests cover zero rate and allocation 12000 retaining 1200.                                                                                                                                                         |
| P2 accessibility: per-field Undo                  | Admission changes carry field merge keys. With the history clock advanced between digits, one Undo restores the prior full value; a different field remains a separate step.                                                                                                                                                                |
| P2 architecture: tagged budget identities         | `admissionPolicy.ts` supplies node/endpoint-tagged quota and concurrency identities to planning and playback. Covered with the namespace regression above.                                                                                                                                                                                  |
| P2 architecture: resolved implicit allocations    | Retain resolved allocations in admission state, with explicit definitions authoritative. Planning and playback use the same map; edits invalidate reference-only callers and checkpoints preserve active leases.                                                                                                                            |
| P2 architecture: deterministic Checks             | Rules produce English text and structured rejection metadata. Presentation translates the metadata. German checks equal English results byte-for-byte; rendering the cached result follows the active language.                                                                                                                             |
| P2 correctness: one-request bucket fit            | Positive-demand calls with cost above burst/amount have zero usable capacity. Zero and positive undersized bursts are checked against playback after refilling.                                                                                                                                                                             |
| P2 performance: static request requirements       | Compile endpoint lookups, tagged keys, deduplicated charges, priorities and concurrency limits. A 500-endpoint/32-quota fixture performs no endpoint searches or JSON serialization across 100 subsequent requests.                                                                                                                         |
| P2 tests: actual edge visits                      | Replace the empty-edge/filter-access spy with a connected 24-target fixture counting element reads. An introduced full-edge scan fails with 624 visits against a 196-visit bound; the indexed implementation passes. No change to the already-linear incoming-edge implementation was needed.                                               |
| P2 types: unique endpoint IDs                     | Shared endpoint validation checks IDs rather than whole records, at both import and runtime resolution. Differently capped records with the same ID fail validation and refuse runtime admission.                                                                                                                                           |
| P2 types: malformed endpoint references           | Validate endpointId at native import and preserve invalid runtime references as invalid targets. Numeric, null, empty, object and overlong references fail import and produce zero planning capacity/runtime rejections.                                                                                                                    |

## Alternatives declined

No findings were rejected as false positives. Additional timeline yielding or a lower timeline
limit was not introduced: existing input budgets bound accepted timelines, and operation counts
now show unrelated actions do no managed-policy work. This retains deterministic simulation
initialization without another scheduling mechanism. Whole-record `uniqueItems` was not used
for endpoint identity because records with different caps can still share an ID. Invalid numeric
drafts are not silently clamped; feedback states the actual retained value.

## Deliberate regression evidence

With production fixes temporarily restored to the branch's original source, 18 new unit cases
and four focused production browser cases failed on their targeted defects. The Undo test was
corrected to use the app's Undo button rather than native text-field Undo, then separately
verified to fail with the field merge tags reverted and pass with them restored. The controller
batching change was separately reverted and its new test failed. The edge-visits guard was
checked by introducing an actual per-node full-edge scan; that test failed. All temporary
mutations were restored.

New validation messages use English catalog keys with the existing fallback in other languages;
the rest of the P3 translations are retained. Catalog validation reports no errors, with missing
translations and existing glossary warnings reported rather than treated as translations.

## Final validation

- Focused admission, Checks presentation and controller tests pass. Final full unit run:
  482 files passed, 6,259 tests passed, four skipped; startup chunk guards are included.
- All 239 requested Chromium cases pass against the production e2e build: live, capacity,
  all four Checks specs, sim-truth, Planning P1/P2/P3, network devices and i18n, on ports
  6150–6154. The validation-feedback screenshot case also passes on 6155–6159.
- Production build and entry size pass: 103.9 kB gzip against the 123.5 kB budget.
  i18n validation reports zero errors, with existing glossary warnings and English fallbacks.
- `pnpm schemas` regenerates the shared skill validator. `pnpm skill:release` refreshes the
  committed viewer, and `pnpm skill:check` confirms it is current. Plugin 1.1.18 is exactly
  one patch above master 1.1.17. The branch is rebased onto master `fb5be11`.
- Lint, typecheck and format are the final gates before the signed commit.

The first full unit run caught the generated skill validator becoming stale, fixed by schema
regeneration. An early browser run used native text-field Undo in the new test; it was corrected
and the app Undo regression was deliberately checked with and without merge tags. A concurrent
verification run timed out in the unchanged `liveRenderer` worker-selection and infrastructure
picker tests. Both passed in isolation (30 tests), followed by the complete passing unit run
without competing build/browser work. No timeout budgets or unrelated tests were changed.
The first final lint attempt traversed temporary regression source copies; those scratch copies
were archived as text before rerunning the final gates. All Playwright-managed servers were
stopped after their runs.
