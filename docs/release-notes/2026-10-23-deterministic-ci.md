## Deterministic complexity tests and parallel CI

Complexity regressions count loop iterations, function/callback entries, copied elements and
serialized/trimmed characters instead of repeatedly timing work under coverage. Probes are injected
only by Vitest and never enter production builds. Parser tests can isolate their warmed reader so
unrelated parsing cannot hide a quadratic scan. Existing constant, linear, n-log-n and quadratic
contracts remain; runaway regressions fail at an operation limit derived from the smaller input.
Native regex backtracking keeps its original timing guards in the Benchmarks workflow.

Vitest separates parallel covered units from serial, uncovered heavy tests. Sampling and invariant
sweeps, retry-storm evidence, public-example precision checks, skill packaging and the other long
simulation checks retain every assertion and sample. CI runs static checks, three coverage shards,
build/size/ZIP and heavy tests independently, preserving the existing aggregate check names.
Native-copy probe helpers preserve coverage function identities across shards; configuration changes
compare every file and total with an unsharded run at the exact same tested revision.

An owned flake ledger and `scripts/ci/known-flakes.mjs <run-id>` classify structured failed tests.
Unknown failures, missing reports and infrastructure failures fail closed. ZIP and sampling timeout
entries cannot excuse assertion failures. The three #263 fixes are excluded. Forty-five overlapping
load/backstop fragments are consolidated into one investigation with immutable evidence links.
Machine reports preserve unhandled runner errors, interrupted runs and snapshot failures, so a known
test failure cannot hide an unrelated runner defect.

Output parity is unchanged: no golden is intentionally changed or re-recorded. No product control,
simulation behavior, test assertion, sample count, timeout or bundle budget is relaxed.
The scale-equivalence Vitest snapshot moves with its heavy spec; its bytes and SHA-256 are unchanged.
