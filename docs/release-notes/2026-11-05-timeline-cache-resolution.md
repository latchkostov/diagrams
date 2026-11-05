## Bounded timeline cache resolution (#435)

Imported simulations no longer retain a complete node snapshot after each
property edit. Purge validation and the step editor share one playback-order
resolver containing only effective cache tables. Property edits that do not
touch `cache` leave those tables alone. Other faults reuse the original topology.

The resolver charges its walk and purge target lists against the existing
fault-work bound before allocating state. A 5,000-node, 10,000-step timeline
alternating property edits and repeated boundary faults retains no node copies
or per-fault configurations. Rule additions, removals and simultaneous-step
ordering keep their existing behavior. No limits or bundle reserves change.

## Output parity

No golden changes are intended or recorded; simulation output is unchanged.

## Regression evidence

The amplification case retains one cache-table map, no node copies and no
per-boundary-fault configurations. Five mutation checks reject the original
snapshot resolver, ignored rule additions, ignored rule removals and missing
editor/runtime admission checks. The restored purge/editor regressions pass.

Live measures 128,767 bytes gzip, unchanged from the reviewed head, leaving
89 bytes under the unchanged 128,856-byte reserve. The compact resolver keeps
only cache state; no bundle limit or fault-work limit was increased.
