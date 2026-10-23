## Canvas first-view headroom and shared Checks topology

Node simulation settings now download when a node is selected. Identity fields load independently; renaming,
canvas keyboard commands and image export stay available while that download is held; failed
downloads offer the existing Retry toast from outside the settings chunk.

The original master measured 382,998 bytes gzip. After syncing the inspector changes, the
base measures 382,650 and this branch measures 379,242 (3,408 bytes saved against that base),
below the 380,500-byte target. All bundle budgets are unchanged. Deferring the entire node
inspector was rejected because it exceeded the separate live-session budget.

Slow-motion readouts (the chip, journey clock and scrubber) also load on replay, keeping the
live-session bundle within its existing budget. Play/pause, speed, screen-reader captions,
Esc and download recovery remain outside that chunk. A held download must preserve focus
and allow image export.

Checks shares its compiled topology with message-type propagation, including free play and
saved simulations. Configured node properties are still analyzed independently per simulation;
node property patches and caller overrides do not change compiled forwarding routes. The
existing benchmark now counts two compilations per complete check run (one shared by rules,
one for capacity), down from five, with its expected count unchanged.

No output or parity golden changes are intended or recorded.
