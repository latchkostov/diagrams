## Resolved: R3 capacity assertions after fractional carry

The fractional turnover regressions and fivefold non-divisible capacity properties pass. The two
throughput regressions are fixed without changing their assertions:

- `waits.sampling.test.ts`, filtered local work with nine slots at scale ten: 7,400 sampled
  completions versus 9,990 at scale one (25.93% below, required difference under 1%).
- `nonblocking.test.ts`, mixed fan-out with a dot larger than the pool: 45 sampled completions per
  second versus 50 at scale one (10% below, required difference under 4%).

Local turnover lost its fractional remainder when retirement was bounded by logical completion.
Continuation takeover also charged an extra admission tick as work and omitted the inherited
hold's admission lag. Named minimal regressions catch both; removing each fix reproduces failure.
Moving releases before work additionally required keeping retained pool dispatch after logical
replies, covered by a named regression and the unchanged frozen differential traces.

The owner decided the shrink contract on 2026-10-19: scale one retains four waiting requests against
one slot for about 60 ms. `expectShrinkMatchesScaleOne` replaces the contradictory pool-bound
assertion in timeline and live-edit shrink tests with per-tick scale-one equivalence, no admissions
above capacity, queue/completion accounting and monotone drain. Final counts, emptiness and
checkpoint equality remain intact. No unresolved capacity-contract work remains in this fragment.
