## Annotation persistence test under extreme concurrent load

During the line-editing review, a Linux run with four browser workers sharing two CPUs hit the
existing 30-second whole-test hang backstop in `annotations.spec.ts`, “inline auto-growth and
inspector text stay within persistence limits on reload”. The failure interrupted the final poll;
it did not report an expected/received height mismatch. That repetition had 177 passed and one
failed; the next two repetitions passed all 178 tests each without code changes.

The same spec on a clean `origin/master` checkout at
`d614cf7aec4d7ec4ebb45a794d5d14b223ba5ec7` passed twice with two workers/two CPUs and twice with
four workers/two CPUs. Each master run's SUMMARY was:

`SUMMARY: d614cf7aec4d7ec4ebb45a794d5d14b223ba5ec7 | unit="not run" parity="not run" e2e={"passed":106,"failed":0,"flaky":0,"skipped":0} gate_failures=0`

The timeout did not reproduce on master. Runner pressure is a possible explanation, not a proven
product diagnosis. The annotation test and its assertions remain unchanged. Keep this case in
load follow-ups and investigate expensive fixture work without raising timeouts or adding retries.

The later upstream sync also brought [the circuit-breaker load report](2026-10-22-annotation-load-backstops.md), which independently records this same annotation backstop under CPU contention.
