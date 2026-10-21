## Keep the deadline skill download within its existing budget

The combined deadline and current-master viewer exceeded the unchanged 835,000-byte skill
ZIP limit: 835,792 bytes. Packaging now tries a small fixed
set of DEFLATE memory settings and retains the smallest compressed stream for each file.
The viewer and icon catalog favor different settings. The archive is 834,947 bytes with
identical names, timestamps, CRCs and decompressed file contents. The deterministic ZIP
test now checks every extracted file against its source, as well as the existing budget.
Removing the compression choice reproduces the 835,792-byte budget failure.

No golden changes: this changes only compressed archive bytes, not skill files, diagram
outputs or the simulation engine. Entry and viewer bundle budgets remain unchanged.
The 126-seed engine sweep still applies; no engine source changes in this packaging fix.
