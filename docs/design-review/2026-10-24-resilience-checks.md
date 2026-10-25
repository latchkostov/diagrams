## Resilience Checks UX review (2026-10-24)

The designer-agent code review confirmed one replay-proven probe action, explicit policy and recovery
evidence, undoable static alternatives, and incomplete-probe counts. It adds no global chrome: the
existing Checks rows, inspector and expectation picker carry the feature.

The review found three copy/feedback problems, all corrected: a short-backoff warning must not claim
jitter is absent; throttled outcomes include shed 503, not just 429; and completion feedback must name
the selected translated alternative. The option identity remains deterministic English for edit ops.

Production Chromium coverage passes for keyboard apply/undo of the complete proven policy, static
idempotency alternatives, worker-backed agent parity, and pseudo-locale feedback at 1024 × 768.
The card stays inside the viewport, and its existing wrapping layout carries the longer copy. Existing
waiting-check Arabic/pseudo-locale keyboard tests passed in the neighbouring browser run. The reviewer
did not perform an independent full-app browser walk; these are code-review and automated-browser findings.

Scaling and unproven probe option chips were rejected because they violate the approved one-proven-fix
decision. The existing public resilience comparisons already demonstrate the policies, so another example
and any changed simulation/rendering golden were unnecessary.
