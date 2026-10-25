## Recovery releases every message and held call

Fixed two engine leaks found by resilience sweep seeds `538282733` and `453919836`.
Releasing a processor thread could immediately admit a zero-work reply continuation
while the engine was still compacting that processor's working array. The same work
could then run twice, reuse its committed attempt, and strand held calls, reservations
or later requests. Admission now waits until that working pass finishes, within the
same simulation tick.

Both counterexamples have deterministic, reduced regression fixtures. They check
full message, thread, pool and admission cleanup, plus checkpoint replay. Removing
the admission guard makes both regressions fail. Retry limits, invariant assertions
and their thresholds are unchanged; no seed-specific behavior was added.

## Output parity

`tests/parity/goldens/node/sim/retry-storm/shed-load.json`: five per-second event
hashes change (seconds 3, 5, 6, 7 and 8), because a completed payment is logged before
the subsequent admission pass expires queued requests in the same tick. A direct
comparison with the original engine confirms identical event timestamps, message
IDs, kinds and text; only ordering changes. All counters, checkpoints, latency
statistics and every other Node golden remain unchanged.

## Verification

The 223 targeted simulation unit/heavy tests pass. Both original resilience seeds
also pass their full multiplier-five property replays. Temporarily removing the
fix makes both reduced regressions fail: nested retries report idle holds, and
the managed join leaves four reservations. Production build and entry/viewer/Forge
bundle budgets pass. Regeneration and i18n checks report zero errors.
