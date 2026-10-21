## Requests that wait: timeouts, pools and busy threads

Thread exhaustion keeps its root-cause callout when an upstream gateway starts returning 504s.
Timeout suggestions use the observed arrival rate and the caller's thread budget; the payment lesson
gets 600 ms. Applying one names the connection and its destination (diagram or saved simulation),
with Undo. The inspector identifies simulation overrides beside the affected call fields.

Connection pool moves beside Timeout, with visible hints and no delayed field insertion. Inspector-owned
call and route-filter properties no longer appear again as raw JSON. Existing call pills and hovers
separate calls using connections from calls waiting for one, including freed-thread queues. Pills scale
in presentation and expose their meaning on hover and to assistive technology.

Busy-thread targets use thread vocabulary and an in-field percent / per-pod toggle. The metric explains
what the simulator models and what a real Kubernetes service would publish. Applying the planner's
busy-thread fix preserves the selection and focuses the changed target. Sustained capacity checks credit
that controller's maximum, including partition limits. Findings move to the top of the node inspector;
the configured explanation keeps its first two lines, with the rest behind More, and capacities use
three significant figures.

The payment lesson now includes an order-status route. Run-end lines describe what the timeout, pool
and busy-thread comparisons prove. Expectation labels use component names and the busy-thread lesson's
actual threshold. Gallery lessons appear in learning order, with incidental tags removed and waiting
simulation names in UI words. Dead-letter path and consumer group move under the edge's Simulation menu;
the metric picker uses lowercase “rejected”.

Owner decisions remain unchanged: no example merge, no change to where a fix is saved, no new priority
between competing fixes, and no change to badge counts or the dependent hover outcome merge.

## Output parity

The intentionally edited examples are `blocking-call`, `slow-payment-provider`, `pool-of-40` and
`scale-on-busy-threads`. Their content-dependent exports, descriptions, evidence, simulation expectation
labels and traces are refreshed. Only the payment example changes simulated traffic: its new status route
shares the incoming traffic with checkouts. Pool and busy-thread simulation counters retain their behavior.

The requested capacity correction also removes the stale post-fix capacity warning in the frozen
busy-thread corpus Checks golden; its translated Checks words follow the new planner copy. Its simulation,
planning and export goldens stay unchanged. The shared catalog golden records the localized messages.
The complete golden inventory and validation results follow.

## Golden inventory

Exactly 63 committed goldens change. Every path is listed below; no browser golden changes.

**blocking-call** — Nine goldens change only because the saved simulation now says “Threads held: CPU says all is well”.

- `node/agent/describe/blocking-call.json`
- `node/agent/edit/blocking-call.json`
- `node/evidence/blocking-call.json`
- `node/exports/drawio-meta/blocking-call.json`
- `node/exports/drawio/blocking-call.drawio`
- `node/exports/html/blocking-call.light.json`
- `node/exports/native/blocking-call.diagram.json`
- `node/skill/scripts/blocking-call.json`
- `node/skill/validate/blocking-call.txt`

**pool-of-40** — Thirteen goldens carry the plainer description, waiting-mode simulation names and component names in expectations. Simulated counters and timings are unchanged.

- `node/agent/check/pool-of-40.json`
- `node/agent/describe/pool-of-40.json`
- `node/agent/edit/pool-of-40.json`
- `node/evidence/pool-of-40.json`
- `node/exports/drawio-meta/pool-of-40.json`
- `node/exports/drawio/pool-of-40.drawio`
- `node/exports/html/pool-of-40.dark.json`
- `node/exports/html/pool-of-40.light.json`
- `node/exports/mermaid/pool-of-40.mmd`
- `node/exports/native/pool-of-40.diagram.json`
- `node/sim/pool-of-40/blocking-pool.json`
- `node/sim/pool-of-40/pool-40.json`
- `node/skill/scripts/pool-of-40.json`

**scale-on-busy-threads** — Sixteen goldens carry the plain description, held-thread simulation name, correct end-below-100 labels, planner wording and the corrected post-fix capacity check. Simulation behavior is unchanged.

- `node/agent/check/scale-on-busy-threads.json`
- `node/agent/describe/scale-on-busy-threads.json`
- `node/agent/edit/scale-on-busy-threads.json`
- `node/checks-words/scale-on-busy-threads.json`
- `node/checks/scale-on-busy-threads.json`
- `node/evidence/scale-on-busy-threads.json`
- `node/exports/drawio-meta/scale-on-busy-threads.json`
- `node/exports/drawio/scale-on-busy-threads.drawio`
- `node/exports/html/scale-on-busy-threads.dark.json`
- `node/exports/html/scale-on-busy-threads.light.json`
- `node/exports/mermaid/scale-on-busy-threads.mmd`
- `node/exports/native/scale-on-busy-threads.diagram.json`
- `node/sim/scale-on-busy-threads/busy-threads.json`
- `node/sim/scale-on-busy-threads/free-thread.json`
- `node/skill/scripts/scale-on-busy-threads.json`
- `node/skill/validate/scale-on-busy-threads.txt`

**slow-payment-provider** — Twenty-two goldens reflect the new GET /status route and traffic mix, method filters, named expectations and the good/bad status outcomes. The free-play sampling scale changes from 2 to 5 because the route mix changes the automatic sampling choice. Checkouts and status now share incoming traffic; the resulting counts, planning estimates, trace selection and export payload hashes change accordingly. Node positions and edge geometry are unchanged.

- `node/agent/check/slow-payment-provider.json`
- `node/agent/describe/slow-payment-provider.json`
- `node/agent/edit/slow-payment-provider.json`
- `node/evidence/slow-payment-provider.json`
- `node/exports/drawio-meta/slow-payment-provider.json`
- `node/exports/drawio/slow-payment-provider.drawio`
- `node/exports/html/slow-payment-provider.dark.json`
- `node/exports/html/slow-payment-provider.light.json`
- `node/exports/mermaid/slow-payment-provider.mmd`
- `node/exports/native/slow-payment-provider.diagram.json`
- `node/planning-p2/slow-payment-provider.json`
- `node/planning/slow-payment-provider.json`
- `node/sim/slow-payment-provider/free-play.json`
- `node/sim/slow-payment-provider/no-timeouts.json`
- `node/sim/slow-payment-provider/timeout-600.json`
- `node/skill/scripts/slow-payment-provider.json`
- `node/trace/slow-payment-provider/free-play.json`
- `node/trace/slow-payment-provider/free-play.mmd`
- `node/trace/slow-payment-provider/no-timeouts.json`
- `node/trace/slow-payment-provider/no-timeouts.mmd`
- `node/trace/slow-payment-provider/timeout-600.json`
- `node/trace/slow-payment-provider/timeout-600.mmd`

**Shared outputs.** The two frozen busy-thread corpus Checks goldens reflect the expressly requested autoscaling capacity credit and localized planner copy. The catalog golden records the added English messages and reviewed Arabic translations. No non-autoscaling diagram output changes.

- `node/checks-words/corpus-w1-busy-threads.json`
- `node/checks/corpus-w1-busy-threads.json`
- `node/i18n/catalogs.json`

## Verification

Final parity: `Parity: 2897 goldens, 0 changed, 0 added, 0 missing, 0 stale`; all 99 Linux browser parity cases pass after the intentional updates.

The full unit run initially had seven failing files (a catalog cached before the final English key edit, plus an incorrect status expectation in the deliberately exhausted run). All seven pass in a fresh invocation: 22 files and 261 checks, including startup-chunk contracts. Follow-up example and locale regressions pass as well. No assertion was weakened to hide a camera race.

Production-browser coverage passes three times: 66 affected cases, then 21 final UX cases including the held planning chunk, keyboard paths, Undo, pool hovers, four presentation sizes, Arabic and en-XA. Deliberate reversions fail the new regressions. Production build, size and i18n checks pass. Entry: 108.1 kB gzip / 123.5 kB; skill ZIP: 834,892 B / 835,000 B.

Initial quick/full gates, the requested property sweep and Linux load repeats encountered the shared worker budget and exited 75. The sweep and five-repeat neighbour run did not execute; busy admission is not a passing test run.

A subsequent full Linux gate passed all 13,457 unit tests (four skipped), builds, size checks, Docker smoke and parity. Its browser result was 1,966 passed, five failed, zero flaky: five legacy assertions still expected the old gallery order/tags, top-level edge settings and findings below the explanation. Those assertions now check the requested behavior. All five corrected scenarios pass three times; an added test-setup mistake sent Escape to the root instead of the submenu and was corrected before the final passing run. The final relationship quick gate passes all 24 cases with zero failures or flakes. Final post-commit gate status is reported with the PR.

The post-commit full Linux gate on `94685a63c2fe1b4a3b9a950cafcff37929b1e9a2` passed those checks and every task-specific browser case, but ended with 1,968 browser passes, three failures and zero flaky tests. The three `image-slices.spec.ts` fallback exports stalled at download completion and were canceled by the test timeout. The earlier full gate passed all three. A clean `origin/master` archive and the branch then each passed the affected spec twice with the same Linux image and twelve workers (56 cases per revision). This does **not** prove a pre-existing failure or a fix. The unresolved full-run cancellations are recorded in [the follow-up](../backlog/2026-10-21-export-fallback-download-cancellations.md). Following the verification-budget instruction, the scoped results are recorded for PR CI rather than repeating the full suite again. The delivery follow-up commit changes verification docs only.
