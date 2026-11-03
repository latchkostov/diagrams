## Cache stampedes: review round 1

The cache inspector now shows the running policy. Editing a saved simulation changes
that simulation's setup, preserves the diagram and other simulations, and supports Undo.
The inspector, origin menu and confirmed fix share one policy writer and reject edits
during slow motion or an unsaved run.

A coalesced item's waiting shoppers no longer hide another item's independent-fetch
stampede. Stampede detection and the chip prioritize a qualifying fetch herd. Verification
observes the requested rule and item directly, independently of the display summary.
Ratio expectations read only the bounded ten-second window; herd and maximum-fetch
readouts reuse an active-item summary. Derived indexes stay out of checkpoints.

Regressions toggle coalescing both ways during active requests, checking cumulative
counters, warm contents, existing fetches and waiters, successful replies and drain.
The warning pill uses warning ink, with AA contrast coverage for both themes.

No golden changes are intended in this round. The existing example, lessons, tuning,
expectation bands, checkpoint bound and bundle limits stay fixed.

## Verification

All 55 focused unit regressions pass. Eight deliberate mutations covering the seven
findings fail their assertions before the fixes are restored. Output parity compares
3,342 goldens with zero changed, added, missing or stale records.

The production parity build keeps the cache runtime lazy at 3,293 B gzip. Live's static
download beyond the canvas is 127,153 B: 7,847 B of headroom against its 135,000 B budget
and 1,703 B beyond the existing reserve. Checkpoints during the herd charge 95,240 B at
scale 1 and 95,243 B at scales 10 and 50, below the unchanged 130 KiB bound.
