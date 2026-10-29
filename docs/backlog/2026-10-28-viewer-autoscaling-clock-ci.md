## Viewer autoscaling clock: unconfirmed CI failure

[PR #391 CI shard 3](https://github.com/latchkostov/diagrams/actions/runs/40813637497/job/123250852006)
fails `viewer-bundle.spec.ts:96`, in "Interactive HTML: busy-thread autoscaling, readouts and a recorded
replay". After the setup clock advances 1,500 ms, `data-desired` remains 1 instead of greater than 1;
the existing 7,000 ms assertion backstop expires. The shard finishes with 529 passed and one failed
in 14.3 minutes. This is an assertion failure, not an action/job deadline.

The group D change only changes scheduling, timing data and shared build consumption; it does not
change the viewer, engine or this spec. A clean origin/master copy at
`31d4b40c826afa44be1f4b4c9c18b47551f5136e`, inside the same workspace, runs only the complete affected
spec twice in the pinned Linux image: three workers/CPUs, production builds, ports 6700–6704, zero
retries. Both repetitions pass (12 + 12). The copy remains clean and the gate stops its servers and
container. This does **not** reproduce the CI signature or establish it as a known pre-existing failure.

## Next evidence

Retain the CI trace and inspect the simulation selection/clock-origin handover before the first
advance, including the emitted simulation time and controller sampling window. A lazy or deferred
handover is a hypothesis, not a proven cause. Preserve the desired/starting/ready assertions, fake-clock
steps, capture/replay checks, corpus and all existing backstops. Do not add sleeps or weaken a check.
The Nightly deadline work does not claim to fix this viewer failure or claim that PR CI is green.

```text
SUMMARY: 31d4b40c826afa44be1f4b4c9c18b47551f5136e | unit="not run" parity="not run" e2e={"passed":24,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```
