## Engine attempts R2: terminal residency and thread-tail accounting

Quota rejection of an in-place broker retry now releases the request's resident weight exactly once,
returning memory and request pressure to baseline after draining. Terminal acknowledgement and failure
share the residency finalizer; retained in-place retries keep their residence until their final outcome.
The last resident clears the aggregate exactly, including subtraction roundoff at fractional scales.

Thread-tail occupancy reads use a per-node aggregate maintained on addition, release, continuation
takeover and reset, and preserved by checkpoints. Simultaneous non-blocking completions therefore do
linear accounting work. Replica reassignment also collects sampled drain ownership by group in one
work traversal instead of rescanning all work for every group.

No golden changes are intended, including all scale-1 goldens. Generators, tolerances and test
backstops are unchanged. Regressions cover retry rejection at scales 1 and 10, drained generated runs,
completion operation counts and multi-group drain ownership reads.
