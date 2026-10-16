# Autoscaling A2 review round 2 (2026-10-15)

Rebased `feat/autoscaling-a2` onto `origin/master` at `66583484` (#122, #123 and #124).
Both documentation histories and both code changes are retained. Generated skill files and
marketplace started from master, then schemas and the viewer were regenerated. Plugin 1.1.26
is exactly one patch above master's 1.1.25. No golden was hand-merged.

All five P1 and eight P2 findings are accepted. Four import entries describe the same dependency
projection defect; the two test findings expose coverage gaps rather than new engine defects.
There are no rejected findings.

| Report finding                             | Resolution and regression                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 architecture: large-import projection   | Namespace selection takes the transitive closure of KEDA sources and named-group routes before mapping. Required nodes count toward both picker budgets. Automatic selection regression uses 302 nodes.                                                                                                        |
| P1 correctness: connection reversal        | Reversal uses the shared edge preflight. Reversing the sole group route is refused atomically, preserving a saveable native diagram.                                                                                                                                                                           |
| P1 correctness: RabbitMQ default protocol  | Omitted/auto protocol resolves HTTP(S) or AMQP(S) from the host before choosing outstanding-message visibility. Explicit settings survive; unknown or unavailable schemes are diagnosed. Tests check outstanding-only metrics. [KEDA 2.18 source contract](https://keda.sh/docs/2.18/scalers/rabbitmq-queue/). |
| P1 correctness: namespace source selection | The same closure retains cross-namespace brokers and group-defining routes, plus their boundaries, while the checkboxes remain explicit choices. Automatic and explicit selections have separate assertions.                                                                                                   |
| P1 security: colliding node/edge IDs       | Clipboard allocation retains a shared uniqueness budget but uses separate node and edge maps for endpoints, inferred groups and implicit edge-ID groups. Hostile node/edge collisions normalize to unique, correctly connected IDs.                                                                            |
| P2 accessibility: Fixed resources          | Resource controls and the imported workload lesson remain in Advanced for absent, Fixed and unsupported controllers. Only controller settings require a controller. Structural and production import tests cover this.                                                                                         |
| P2 accessibility: lesson focus             | A successful lesson commit focuses the surviving CPU cost field after the button unmounts. Production keyboard tests cover enabled and Fixed imports.                                                                                                                                                          |
| P2 architecture: node/edge transaction     | Relationship inference is a pure transformation. The full node patch and inferred edges pass one preflight and commit together. The regression disables KEDA while changing its worker to ConfigMap and counts validation calls.                                                                               |
| P2 performance: metadata edits             | Title, description, color and direction bypass resource preflight. Planning and saved simulations still validate. Tests count validator calls rather than milliseconds.                                                                                                                                        |
| P2 security: omitted import source         | If the supplied graph lacks a source or its route, retain the workload/resources, explicitly mark the policy unsupported, and report why scaling was not imported and how to recover. No dangling internal source key remains executable.                                                                      |
| P2 tests: copied binding identity          | Copy assertions compare the complete policy, require copied brokers for paste/duplicate and the original external broker for connected clones, and preserve the original policy.                                                                                                                               |
| P2 tests: unavailable sleeping fleet       | A broker outage spans more polls than the fallback threshold. Desired, ready and starting remain zero; restored traffic wakes only at the next poll. Existing correct engine behavior is unchanged.                                                                                                            |
| P2 types: selected boundary imports        | Explicit boundary selection shares the same closure and budget logic. The 200-seed selection sweep covers Kafka, Service Bus topic/queue, SQS and RabbitMQ, proving that every retained executable scaler has its source and named route.                                                                      |

The scoped designer source/test gate found two report-copy issues and a stale selected count.
The report now explains automatic dependency inclusion and omitted-policy recovery. Its heading
counts current explicit selections, including checkbox changes. Three new messages have translations
in all 37 catalogs. No global chrome was added. The review did not include an independent browser
or assistive-technology walkthrough; production browser tests cover the changed interactions.

Rejected approaches: silently dropping a policy or leaving it pointed at an original copied broker
would preserve native validity while changing meaning, so tests assert identities explicitly.
Automatically checking a dependency namespace would select all its unrelated nodes; checkboxes keep
representing explicit selection while only required dependency nodes come along. Existing graph
edits still refuse invalid bindings rather than silently disabling a saved policy. The unsupported
fallback applies only to infrastructure import, with an explicit recovery report.

## Regression controls

Restoring all seven changed implementation modules to their rebased pre-fix versions caused
18 unit failures spanning the eight implementation defects and the seeded import selections.
Restoring the files made the focused 274-test suite pass. Removing the lesson focus handoff from
a production build failed the keyboard focus assertion. Deliberately allowing fallback to activate
a sleeping fleet failed its new test. Keeping copied policies on the original broker and dropping
copied policies each failed the new identity assertions. Every temporary mutation was restored. A further deliberate reversion to committed rather than staged
node reads failed the successive-stencil regression, protecting ordered edits before React commits.

## Verification

The first unrestricted unit run had 7,316 passes and one timeout in the existing 5,000-node
Draw everything test (four existing skips). The complete suite passed with three workers without
changing timeouts or assertions. After the staged-inference regression was added, the final full
run passed all 536 files and 7,319 tests, with four existing skips and no type errors.
The 5,000-seed stress run passed (5,001 tests including the type-check test, no type errors).

The production Chromium run passed all 228 requested tests (plus CSP) without retries on ports
6300–6304, including both new import regressions. Playwright stopped its servers afterward.
Production build and size passed: the entry is 105.7 kB gzip against a 123.5 kB budget.
The initial full parity run matched 1,853 goldens and found only the expected catalog change:
three new translated import-report messages change counts and area hashes in
`node/i18n/catalogs.json`. That single record was updated with a filtered update; no simulation,
export or other output was re-recorded. The eight pre-existing browser parity deferrals remain.

The final full parity check matched all 1,854 goldens: zero changed, added, missing or stale.
Its Linux Chromium tier passed 52 tests with eight existing deferrals. `pnpm i18n check` passed
with zero errors/stale strings; the 78 pre-existing missing translations per locale are unchanged.
All three new messages are translated into every catalog. `pnpm skill:check` confirms the released
viewer matches a fresh build. No task server remains listening on ports 6300–6309.
Final lint, typecheck and format checks run immediately before the signed fix commit.

The first final-lint attempt caught a literal JSX test label and a forbidden non-null assertion
in the new tests. Both test-only style errors were corrected before repeating affected tests and
the final lint/typecheck/format gates; production behavior and parity output were unchanged.
