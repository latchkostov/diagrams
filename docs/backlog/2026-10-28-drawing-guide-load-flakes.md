## Drawing guide setup under Linux load

During #377 verification, `drawing-precision.spec.ts:124` (alignment guide) and `:155`
(equal-spacing guides) failed with zero guides. Both failures reproduce identically on clean
master `093cfb14a4fc003493ca7a85f562341bd1dd5d53`, with eight workers and six container CPUs.
The first master repetition passed all 14 cases; the second passed 12 and failed these two.

`SUMMARY: 093cfb14a4fc003493ca7a85f562341bd1dd5d53 | unit="not run" parity="not run" e2e={"passed":26,"failed":2,"flaky":0,"skipped":0} gate_failures=1`

The same shared drag setup also produced a 3.305 flow-pixel offset in the free-drag case at
`:143` once on the repair branch; that variant did not fail in the two master repetitions.
Investigate the first small pointer move and the drag's actual committed origin. Preserve all
guide, spacing, snapping and free-drag assertions and their existing tolerances.
