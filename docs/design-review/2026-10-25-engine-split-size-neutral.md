## Scope and UX review

This fix changes internal wiring and download overhead. Controls, text, frame contents, event ordering,
traces, counters and replay behavior retain their existing contracts. The chrome budget is unchanged.

The public frame projection belongs with the facade's particle, fault, resource and route state. Its waiting
ranking is private to that projection. Accounting receives explicit synchronous commands and queries;
checkpoint-replaceable roots remain owned by the facade, and no callback enters checkpoint data.

## Alternatives reviewed

A broader mutable engine context, extra query factories and indexed callback tables added coupling or bytes
without enough benefit. Independent stateless wrappers also increased the emitted payload. The chosen seam
keeps the import-boundary guard and uses the existing minifier, compression settings and budgets.

## Verification

The original minified adapter retained internal port names as object keys. The new production-artifact test
rejects those names: it failed with the original adapter temporarily restored, then passed with this fix.
All 26 bundle tests passed, including startup boundaries. Simulation units passed across 67 files: 1,561
passed, five expected failures and one skipped test. The actual downloadable ZIP test passed its deterministic
archive and strict 835,000-byte checks. Regeneration, skill freshness, build, size, types and formatting passed;
lint passed with zero errors and nine existing warnings. Node parity checked 3,045 goldens with no changes,
additions, missing files or stale files.

The sweep used `--count 10 --multiplier 5 --heavy-count 0 --jobs 3`:

```text
SUMMARY: 10 passed, 0 failed, 0 unrun; 685.36s
```

The first local sweep hit the existing five-second timeout. The successful rerun used the repository's CI
timeout configuration with the same count/multiplier options and unchanged assertions. Temporary comparison
artifacts also caused the first lint run to fail; moving them to ignored test output restored normal lint scope.
