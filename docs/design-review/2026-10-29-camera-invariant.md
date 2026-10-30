## Camera invariant fix: UX review

The camera keeps the existing ownership rules: slow motion absorbs pending panel and
narration work, and canvas work waits behind menus. Two matching rendered pane samples
remain the readiness rule; changing pending work between those frames no longer loses
the first sample. A rendered deferred frame invalidates it, preventing stale geometry
from being used after the menu holds work.

No controls, copy, chrome or examples are added. Live's preserved camera, narration's
zoom-preserving pans and manual camera overrides keep their existing behavior.
