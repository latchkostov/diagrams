## Engine Nightly counterexamples: A1 seed 3575 and I7

Fixed retained retries after a live API quota removal: an obsolete admission deadline
could end a newer CPU backoff during recovery, then reset that backoff after pause/down.
Scheduling each retry now replaces or clears its admission deadline according to the
current policy. The eight-event, scale-10 A1 seed 3575 reproduction is a named regression.
The original seed and reduced case fail with the fix removed and pass with it restored.

Both I7 Nightly seeds (56784600 and 1965200503) pass on current master at the unchanged
20× run count. PR #233 (`4877f5dc`) already separated unfinished cohort CPU from a
continuation taking over a retained thread. Added scale-10 regressions for both logged
reduced inputs, checking three spaced requests, successful and failing callees, exact
logical outcome timestamps and complete drain with and without ledger holds. Both
regressions fail when that CPU-tail separation is temporarily removed.

The original October 22 log has two nonblocking calls, one to a zero-CPU resource leaf;
October 21 has a blocking call and a nonblocking side call. This records the actual
reduced logs rather than assuming their topology is identical.

Node parity: 3,045 goldens checked; none changed, added, missing or stale. Regenerated
the committed skill viewer so installed viewers include the engine fix. No budgets,
run multipliers, invariants, assertions or plugin versions were relaxed.
