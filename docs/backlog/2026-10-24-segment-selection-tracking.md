## Stable segment identities across reroutes

PR #281 quarantines keyboard segment tracking after two review rounds found that geometric
matching can select an overlapping leg and can reuse geometry made stale by pointer shaping.
The active segment now resets on route changes, except a keyboard nudge that preserves segment
structure. The edge stays selected; ] and [ restart at the first and last segment.

Proper tracking needs stable segment identities carried through route construction, pointer edits,
normalization, endpoint escapes, node moves, reconnects, undo/redo and remote edits. Merges and
splits need explicit identity rules. Keep only identity/index selection state and derive geometry
from the current route on every read; never match against a stored selected-leg geometry.

Before restoring tracking, cover overlapping collinear legs, pointer shaping followed by a nudge,
merges/splits and endpoint detours, history and remote updates, including lazy control remounts.
