## Native runner evidence: TC-01 and TC-02

Evidence was downloaded on 2026-10-24 into the ignored `tests/.output/p2-evidence/` directory.
This closes the collection/inventory work, not the unresolved native defects. No new quarantine,
timeout increase, retry or broad flake signature is justified by this inventory.

## Hosted slow-motion diagnostic

[Nightly 40062802399](https://github.com/latchkostov/diagrams/actions/runs/40062802399), revision
`202efb084479cff67f8a78f184899ffcb7e8110c`, artifact `nightly-slowmo-teardown-evidence`,
contains `rfkwape/{e1,e2,e3}/results.json`, failure traces and synchronous `teardown-probe.jsonl` files.
All four diagnostic bodies executed in each repetition: **12 executed, 3 passed, 9 failed,
0 flaky, 0 skipped**, with three workers and zero retries. This is hosted Windows evidence,
not another fast local repetition. It predates the slow-motion machine migration (#269).

| Exact title                                                                                | Repetitions 1 / 2 / 3    | Evidence                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| engine changes are disabled consistently; tracing, sequence and recording remain available | failed / failed / failed | First: zero particles at setup, then context teardown exceeded its backstop. Second: zero particles. Third: whole-test timeout during More click. |
| an open Inputs panel and capacity Apply fix wait until slow motion ends                    | failed / failed / failed | Disabled-control check, missing capacity input, then whole-test timeout.                                                                          |
| Esc restores the pre-replay viewport (fitted)                                              | failed / failed / failed | First two fail before Live controls mount; first also stalls in context close. Third exceeds the whole-test backstop.                             |
| Trace a message ▸ and the command palette start it; Record video offers this slow motion   | passed / passed / passed | Executed every time, not skipped.                                                                                                                 |

The first controls probe at `04:36:05.346Z` has one terminated worker, four transferred canvases,
one outstanding animation callback, no timers, no recorder and no pending fetch headers.
Context close begins at `04:36:05.429Z` with no open workers, but the network observer still
lists the worker script request; it ends at `04:36:28.561Z`. That observer entry is not proof
of an active worker. The first Inputs probe has a live worker before close, and logs its closure
during teardown. These distinguish worker shutdown from delayed context/trace disposal; they
do not establish a product resource leak. Keep all four ordinary Windows quarantines and bodies.

## Complete inventory of the named native run

[Nightly 39137867503](https://github.com/latchkostov/diagrams/actions/runs/39137867503), revision
`21c17fe35bb5ee2c919da062da300a88ba7808ab`: extracted every `nightly-results-native-*`
artifact, including all six Windows and eight macOS E2E shards and both unit reports.
Windows: **1,578 passed, 13 failed, 4 skipped**. macOS: **1,591 passed, 4 failed, 0 skipped**.
Both unit runs: **10,637 passed, 0 failed, 4 skipped** each. No flaky E2E results.
The four skipped Windows tests are separate from the 13 executed failures below.

The identities below are taken from structured results, not inferred from filenames or a later
green run. “Unresolved” means no causal fix or clean-current-master reproduction is established
by this investigation; it must not be described as a confirmed master defect. Related changes
are identified as such rather than being credited with fixing a different test.

| OS/shard    | Spec and exact title                                                                                                           | Original failure and subsequent disposition                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 2/6 | `csp.spec.ts` — live view on the particle worker, slow motion, and a recorded video                                            | Missed `0:01`, observed `0:06`. #175 replaces the wall clock with `recordFor(page, 1)` and retains the exact assertion.                                                         |
| Windows 2/6 | `sim-truth.spec.ts` — editing shows it with the heat map on; presenting shows only the plan's callout                          | Navigation load timeout. Unresolved native loading observation.                                                                                                                 |
| Windows 2/6 | `sim-truth.spec.ts` — paused, Revive in the callout clears it at once; Dismiss returns focus to the canvas                     | Callout remains after Revive. Unresolved; not the recorder or teardown case.                                                                                                    |
| Windows 2/6 | `trace.spec.ts` — a dead-lettered trace on Poison invoices shows the retries and the DLQ hop                                   | Whole-test timeout. Unresolved trace/loading observation.                                                                                                                       |
| Windows 3/6 | `showcase-examples.spec.ts` — Inputs stays visible and editable above playback                                                 | Failed layout predicate. Unresolved; #257 later reorganizes Live details but does not establish this failure's cause.                                                           |
| Windows 4/6 | `autoscaling.spec.ts` — A1: production playback shows starting backlog, ready capacity, real resources and history             | Failed boolean readiness predicate. Unresolved.                                                                                                                                 |
| Windows 4/6 | `record.spec.ts` — the browser's real recorder writes a WebM that players can measure                                          | Expected two seconds, observed four. #175 uses `recordFor(page, 2)` and pins the paused review clock. Separate from context disposal.                                           |
| Windows 5/6 | `lazy-examples.spec.ts` — switching back before a pending example loads keeps the live link                                    | Browse examples click timeout. Unresolved native loading observation.                                                                                                           |
| Windows 5/6 | `lazy-examples.spec.ts` — live changes while an example is pending stay with the diagram on screen                             | Browse examples click timeout. Unresolved native loading observation.                                                                                                           |
| Windows 5/6 | `lazy-examples.spec.ts` — Back during a pending example restores the open diagram's current live link                          | Live controls missing. Unresolved native loading observation.                                                                                                                   |
| Windows 5/6 | `round7-polish.spec.ts` — live view with a trace refits when the AI panel opens: every node stays in the pane                  | Pane predicate fails. #275 later fixes camera setup/readiness in this family; this historical identity is not reclassified as a confirmed master failure.                       |
| Windows 5/6 | `slowmo.spec.ts` — Space pauses, ← and → step hop by hop, and a trace card hop seeks                                           | Whole-test timeout. Unresolved; neither this title nor the next is one of the four diagnostic quarantines.                                                                      |
| Windows 5/6 | `slowmo.spec.ts` — Esc goes back to live exactly where it left off, paused or playing                                          | Whole-test timeout. Unresolved; #269 changes the lifecycle, without establishing a native teardown fix.                                                                         |
| macOS 2/8   | `round13-polish.spec.ts` — double-click quick-add opens the new node's name: typing names it, never reaching the canvas's keys | Name field inactive. Unresolved focus observation; the held-identity fix in #275 targets a different generated test.                                                            |
| macOS 7/8   | `annotations.spec.ts` — inline auto-growth and inspector text stay within persistence limits on reload                         | Reload height `9238px` instead of `20000px`. #179 adds an explicit saved-text readiness assertion before reload; geometry failure is not claimed fixed by that assertion alone. |
| macOS 7/8   | `capacity.spec.ts` — adding an entry point is one undoable topology edit                                                       | Original edges temporarily absent after Undo. Unresolved topology/rendering observation; keep the exact topology assertion.                                                     |
| macOS 8/8   | `followups4-inspector.spec.ts` — Inspector resize leaves a paused slow-motion camera unchanged (follow)                        | Viewport changes while paused. #169 fixes pending follow pan, with controller and pane-policy regressions.                                                                      |

## Generated surface, Retry and tint evidence

TC-03 is already addressed by #275 (`815ea15b`): the generated simulation entry waits for
the independently loaded identity field, its rename focus and interaction idle. Its held-identity
regression prevents settings readiness from prematurely completing setup. Keep that test and the
generated `inspector.simulation` contract; do not add an unproven flake signature.

TC-04 now holds the Playwright clock before starting/retrying slow motion, advances capture's
animation-frame yields explicitly, checks active playback, then crosses the final replay beat and
requires progress `1000` and machine state `finished`. This separates startup from legitimate
completion. The original wall-clock assertion could sample a completed replay after runner delays;
no playback behavior or timeout needs changing.

For TC-05, inspected PR #268's failed attempt in
[CI 40054694693](https://github.com/latchkostov/diagrams/actions/runs/40054694693), artifact
`playwright-output-6`, trace `c0376b5c034769b60daf6a802d31cfd9cbe6b20c.zip`.
It fails filling the absent hex input, before Undo or presentation. The click point is `(1293, 238.01)`;
the next snapshot inserts the independently lazy Markdown description above Colour, with an
editing textarea. The description arrived between the button hit-test and pointer dispatch.
The setup now awaits that field before clicking, with a held-description regression. Exact tint,
Undo, redo and presentation assertions remain. The earlier observation fragment is retained.
