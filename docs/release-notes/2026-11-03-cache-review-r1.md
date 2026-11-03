## Cache authoring and live readouts

Adding cache rules from Properties preserves the selection and focuses Add rule after the lazy
editor is ready, matching the context-menu action (R-b680ef893b). Message patterns retain their
typed draft, so `Page, Invoice` saves two patterns and Undo restores the previous value
(R-cd56e4ce6b, R-8818ec643d).

Cache explanations and capacity analysis share the effective simulation policy, including rules
and a Default policy introduced by simulation setup (R-7e73679f04). Changing a saved run's Traffic
or Capacity multiplier refreshes its expected-hit baseline without clearing entries, counters or
random streams (R-e466534e7f).

Completed cache responses now have one aggregate latency distribution that includes no-store
requests. Node p95 expectations, hover, dock and badge data use that response distribution; hit
and miss histograms remain separate breakdowns (R-c187ab839a, R-f593fd1659).

## Bounded work and checkpoints

Origin readouts precompute outgoing counts and labels (R-78e001cec1). Inputs and node Properties
reuse cached cache derivations and their compiled topology (R-03d62da1ae). Cache fields copy the
document once per editor version and check graph counts before copying (R-004859829b). Expected
hit shares are calculated on configuration changes and retained in checkpoints, outside frame
and percentage-measurement work (R-ed5635fcfa).

The new warm full-ring guard populates all 4,096 fractional expiry slots across 256 rules and
every 32-sample fetch ring, then checks exact restore and replay (R-991618a0d2). Lossless run
encoding compresses repeated ring values. The warm checkpoint is 156,424 B against a 31,624 B
baseline: a 124,800 B increment within the unchanged 133,120 B limit. The existing cold full-ring
fixture has a 109,625 B increment. Neither numerical precision nor test limits change.

## Output parity

No golden has been re-recorded for this fix round. The regression covers mixed cacheable and
no-store traffic; the existing parity corpus has no changed output, including Black Friday's
already-approved feature changes.
