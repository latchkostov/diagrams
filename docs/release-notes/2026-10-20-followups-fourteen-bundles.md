## Follow-ups 14: smaller initial downloads

Synced the branch with master, taking master’s generated viewer and regenerating it.
Default annotation outlines remain immediately available. The extended outline geometry
loads on first use of a non-default shape, and outline attachment sampling loads when a
shape is shown. Until then, outlines and handles retain their saved dimensions; loaded
geometry invalidates both handle and route caches without editing the diagram.

The boundary inspector (and its custom colour picker), provider/format artwork, and
converter-only validation now load when used. Native resource/routing validation stays
in the existing preloaded native chunk, avoiding an extra startup request. Shared import
validation has one implementation. No bundle budget was raised.

CI’s production bundle measurement (`node scripts/bench/bundle.mjs`, sum of individual
chunks compressed with gzip level 9) reports:

| Download                    | Before (after sync) |     After |    Budget |
| --------------------------- | ------------------: | --------: | --------: |
| Startup                     |           177,025 B | 176,392 B | 177,000 B |
| Canvas first view           |           385,532 B | 380,342 B | 383,000 B |
| Live session, beyond canvas |           132,437 B | 132,428 B | 135,000 B |

No parity golden changes are intended or recorded, including the i18n catalog.
The static outline parity harness explicitly waits for the optional geometry before
recording the same primitives and attachment points.
