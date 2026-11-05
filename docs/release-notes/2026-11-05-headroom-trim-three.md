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

Measured against post-#435 master (`58a3a05e1`), with both builds using the same build metadata:

| Output                                 | Before (bytes) | After (bytes) | Freed (bytes) |
| -------------------------------------- | -------------: | ------------: | ------------: |
| Live session, beyond the canvas (gzip) |        128,771 |       122,084 |         6,687 |
| Skill ZIP                              |        826,342 |       819,395 |         6,947 |
| Canvas first view (gzip)               |        367,813 |       367,819 |            -6 |

The canvas changes by six bytes with lazy-surface registration and generated chunk references; none
of the deferred drawing modules moves into its first view. `MainThreadLoop` now owns the main-thread renderer, particle and
march drawing, canvas fonts and calm sampler. The shared frame loop, geometry and hit testing stay
available to the worker path. Viewer-only adapters remove editing history and clipboard code.

All 3,358 output goldens are unchanged. No goldens were re-recorded for this trim. The required
Linux browser subset passed both runs; the broader full gate's unclassified download timeout is
recorded in [the verification follow-up](../backlog/2026-11-05-headroom-trim-three-svg-download.md).

Rejected: deferring cache readout panels again (they already load on demand, with too little
remaining eager code to meet this trim), and removing playback, recording or read-only keyboard
navigation from the viewer (those are supported behavior).
