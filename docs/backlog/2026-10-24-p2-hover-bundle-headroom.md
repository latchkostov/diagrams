## Startup and Live bundle headroom

OPEN. Owner: @latchkostov. Schedule a dedicated trim PR; preserve the fixed budgets and startup import contracts.

The hover-card batch's bundle-only measurement against merge-base `8e58be7e421cd6b812d85ec0182a13244d59e8de` passes all four gates. Startup has 6,506 bytes of gzip headroom (170,494 / 177,000); Live has 4,933 bytes (130,067 / 135,000). Both were already below the 8,192-byte warning floor at the merge-base. The changes reduce startup by 19 bytes and add 482 bytes to the lazy Live session. Canvas first view falls by four bytes to 374,584 / 383,000.

Keep this separate from the hover/Live correctness fixes. Re-run the bundle-only report and startup-chunk contract when trimming; do not raise limits or move optional readouts into first view.
