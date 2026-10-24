## Untrusted input bounds: review fixes

Collaboration rooms reserve space for unresolved Yjs dependency bookkeeping before applying updates, including
repeated struct identities with different missing origins. These charges remain until pending structs drain;
encoded state alone cannot reclaim them. Rekeying retires the old epoch's sender slots while preserving the
document's aggregate state cap, so sender turnover does not exhaust the room's lifetime allowance.

Selecting an oversized page in a multi-page draw.io import now returns the node-budget error through the existing
error toast instead of throwing out of the page picker. The HTML complexity regression also counts native
closing-delimiter searches. No parity goldens changed; this fix round runs only targeted regressions.
