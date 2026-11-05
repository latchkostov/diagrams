## More room for Live playback and offline viewers

Live's ordinary worker path no longer downloads the main-thread fallback's particle drawing,
calm sampler, marching-edge renderer or canvas-font loader. Browsers that need the fallback
load it through the shared lazy-surface contract. The controller stays mounted through worker
failure, and image export, recording and print readiness await the fallback. Its loading and
failure states retain keyboard focus and cursor behavior, with the existing Retry toast.
No CSS moves behind the new boundary.

The read-only HTML viewer replaces document history and authoring/clipboard shortcuts with
small read-only adapters. Live Tab navigation, annotation links, pan/zoom, playback and file
replacement remain available. Every skill file stays in the ZIP.

The final measurements below use production gzip at level 9 and the deterministic skill ZIP,
against master including caching PR #435. Budgets, reserves and the ZIP cap are unchanged.

Measurements will be filled after #435 lands. No output golden is intentionally changed;
this change must leave the full parity suite unchanged.

Rejected: deferring cache readout panels again (they already load on demand, with too little
remaining eager code to meet this trim), and removing playback, recording or read-only keyboard
navigation from the viewer (those are supported behavior).
