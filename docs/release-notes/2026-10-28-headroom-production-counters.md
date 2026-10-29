## Production Live worker counters

Restore the two small Live canvas counters used by the production sub-path smoke test:
`data-particles` and `data-frames`. Guarding them behind dev/E2E builds made the ordinary production
app and embed report zero to the test even while their worker was drawing. Pixel readback,
trace-label serialization and benchmark hooks remain restricted to dev/E2E builds. The audit of
all E2E and benchmark specs found no other removed instrumentation needed by ordinary production.

The bundle test now requires these counters and still excludes the larger hooks. No budgets,
reserves, ZIP caps or output goldens change. Production measurements (gzip level 9): Live beyond
the canvas 127,269 B, with 1,587 B under the 128,856 B reserve; canvas first view 358,699 B;
skill ZIP 821,220 B, with 13,780 B under the 835,000 B cap and 7,636 B under its reserve.
Relative to the trim commit, these change by +18 B, +7 B and +7 B respectively.
