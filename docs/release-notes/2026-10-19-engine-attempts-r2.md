## Engine refactor R2: write-once attempts (step 2 of 5)

Request outcomes now settle once on the logical timeline. Replies, counters, outputs and latency no longer
wait for a sampled capacity hold to expire. A later down, boundary outage or drain releases an answered
attempt's resources without reversing its answer. Paused outcomes commit on resume; retries and mixed-call
continuations take over their existing reservation and carry its remaining residence.

`attempt.ts` provides the logical records, write-once settlement and deadline-tie helper. The engine retains
today's thread clocks and CPU accounting for R3/R4. R2 does not add deadline configuration, controls or a
new simulation feature; the existing public blocking-call example demonstrates the corrected timing.

The pool ledger refuses room smaller than one real request (or the whole represented fractional request),
so tiny remainders cannot create effectively permanent holds. Wall-time reservations reject retirement
without a finite wall clock before changing state. Differential traces recorded from untouched master
`1b72a891d57850743420283d4565d9e968b3405f` now reach final completion and include scale-1 counterparts.

One output golden changes intentionally:

- `tests/parity/goldens/node/sim/blocking-call/free-play.json`: at scale 10, callers answer and publish
  their results when logical work finishes, before the remaining partial-capacity hold. Checkpoint caller,
  downstream and in-system counts, throughput, trace hashes and latency reflect those earlier completions
  (caller processing falls from 290–300 ms to 270 ms; the traced completed journeys rise from 190 to 192); resource
  holds continue independently. This is the approved first-wave direction where the reserved weight is
  smaller than the represented cohort. Every pre-W1 and scale-1 W1 golden stays unchanged, as do both
  sampled corpus goldens and all planning, agent, export and browser outputs.

Coverage includes the answered-success/down review probe, down/drain/outage after answer, paused commitment,
retry reservation takeover, a reduced mixed-call continuation case, checkpoint history size and generated
I2/I7 checks alongside the ledger oracle. The property tests passed with `FC_RUN_MULTIPLIER=5`. Temporarily
restoring the pre-fix engine and ledger produced eight expected regression failures. Removing the write-once
guard and broker-pressure cleanup separately also failed their regressions. Acknowledged broker tails retain
capacity without inventing queued request-scaler pressure.

Full parity passed with 2,712 goldens, zero changed, added, missing or stale after recording the single
intentional golden above. The production build and startup-chunk tests passed. Entry size is 109.0 kB gzip
against 123.5 kB; the viewer is 592.9 kB gzip against 805.0 kB. Regeneration includes the standalone skill viewer.

The wider targeted run with a fivefold property multiplier hit the existing non-divisible-pool property's
five-second hang backstop (150 generated runs); that spec passed normally afterwards. The R2 I2/I7 and command
properties passed at fivefold load. No timeout or assertion was relaxed.
