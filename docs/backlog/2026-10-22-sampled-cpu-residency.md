## Sampled CPU caller retains resident weight after healthy drain

The circuit-breaker sweep found a pre-existing failure in
`src/sim/ledger.commands.test.ts`, `I3: healthy generated graphs drain naturally,
including admission keys and CPU parts`. Seed `-27429108`, multiplier 5, fails
after 51 cases with shrink path
`50:2:1:1:1:3:3:4:1:1:2:2:6:13:11:11:11:11:11:11:11:11:11:11:11:11:12:12`.

The reduced `p3-w1` graph has no resilience policy: a CPU-backed caller with zero
CPU work, two non-blocking downstream tiers, and sampling scale 3. The engine's
`inSystem` is zero, but the caller retains resident weight 3 at the next invariant.
The test's resource, ownership and cleanup assertions remain unchanged.

## Clean-master evidence

An independent clean copy of current master
`7ccaefe97d4b26cf5fd761ef7c1bc59c16034d70` reproduced the identical counterexample,
shrink path and assertion in both repetitions of the affected spec:

`SUMMARY: 0 passed, 2 failed, 0 unrun; 43.65s`

Each repetition had six passing tests and the one I3 failure. This was a focused
seed replay, not a second full suite. The branch sweep records the failure and
continues its remaining planned seeds without suppressing any assertion.

## Follow-up

Trace sampled resident-weight release for resource-backed, non-blocking callers
whose local CPU demand is zero. Preserve the exact zero-residency invariant and
add the reduced graph as a deterministic regression when fixing ownership.
