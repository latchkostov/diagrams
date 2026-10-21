## Sampling accuracy: same-arrivals test harness

Sampling comparisons now feed the scale-one reference at the sampled cohort arrival instants.
The sampled replay is byte-identical to the old harness; the compared outcomes and I1 tolerance
are unchanged. Harness self-tests cover integer bursts, fractional cumulative totals, source
ownership and replay options.

Every surviving accuracy gap runs outside its expected-failure assertion and has an ordinary
sibling pinning the exact measured outcomes. New pins cover managed admission at 2.5 (599/400),
CPU with a pool at 2 (399/286), CPU without a pool at 1.1 (570/366.3), Lambda joins at 4 (498/400),
deadline cohorts at 2 (1779/510) and a slow callee at 10 (662/570). All match the approved design.
The scale-ten deadline I1 comparison passes coincidentally (356/330); both exact-equality deadline
gaps, continuous scale-one references and zero-local guards remain intact.

The opt-in `--i1` sweep explores generated graphs and continues past failing seeds. It is not a
CI gate. The fixed 40-sample corpus (seed 20261018) starts at 13/31 passing comparisons at scale > 1,
matching the design floor. Restoring the continuous baseline in an isolated copy makes the replay
self-test fail. No engine behavior or golden changes; no golden was re-recorded.
