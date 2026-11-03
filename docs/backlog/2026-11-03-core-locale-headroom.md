## Core locale reserve needs a dedicated trim

Owner: latchkostov (i18n bundle trim).

Arabic's production core catalog is 37,999 B gzip against the unchanged 38,000 B limit after the stampede feature. New optional messages also shift the sorted numeric IDs used by existing core messages, so core compression can change without moving copy into core. Fetching/held pill variants share two ICU messages, and coalesced waiting/count forms share one message; the example keeps its required localized startup summary. All budgets pass; only 1 B remains in this core catalog.

Trim core catalogue ownership or stabilize lookup identities in a separate, measured change. Keep every existing budget and surface-readiness contract. Do not treat optional feature copy as permission to grow the core reserve.

## Live download headroom

The same owner's dedicated bundle trim should recover Live's 8,192 B headroom floor. Its static download beyond the canvas is 127,076 B gzip against 135,000 B: 7,924 B remain, with 1,780 B before the existing 6,144 B reserve. The cache runtime remains a separate 2,944 B lazy chunk. Existing reserve and startup-split gates pass; do not fold the runtime into Live or increase a budget to recover room.
