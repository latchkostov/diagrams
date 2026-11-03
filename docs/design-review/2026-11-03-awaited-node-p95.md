## Latency expectation correctness

The existing p95 expectation now observes awaited service and database completions, so a slow
completed request cannot pass a tight threshold because its intermediate nodes had no samples.
The metric measures arrival-to-reply service time, including downstream waits, and its definition
is beside the request expectation metrics in SIMULATION.md.

## Readout and chrome review

No controls, layout, labels or chrome are added. Non-caching nodes' hover/dock readouts preserve
their existing meaning by keeping the new response histogram private to the expectation metric.
Reusing the async path recorder was rejected because it would alter those readouts and existing
output. Retaining individual response samples was rejected in favor of a bounded aggregate and
exact checkpoint replay. No test, bundle reserve or checkpoint bound is loosened.
