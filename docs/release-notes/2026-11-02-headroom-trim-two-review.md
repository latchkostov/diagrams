## Headroom trim two: preserve Edit loading and viewer navigation

Edit's node settings keep their count formatter in a small shared chunk instead of downloading the Live
implementation. Production bundle tests check the static dependencies of both Disclosure and NodeSettings,
with and without collaboration enabled.

The offline viewer now uses the editor's shared boundary-selection expansion: zooming to a boundary includes
its descendants, member nodes and annotations. Port tests compare the actual camera arguments for outer,
inner and overlapping boundary selections. A rendered-hook regression verifies that the same API object
reads new controlled selections and preferences and invokes new callbacks after rerenders. The installed
skill viewer is regenerated.

Fresh production measurements (Node 24.22.0, gzip level 9):

| Output                 | Before trim | After review fixes |    Freed |
| ---------------------- | ----------: | -----------------: | -------: |
| Live beyond the canvas |   127,584 B |          122,888 B |  4,696 B |
| Canvas first view      |   361,701 B |          361,423 B |    278 B |
| Startup JavaScript     |   160,787 B |          160,700 B |     87 B |
| Fresh skill ZIP        |   824,429 B |          805,584 B | 18,845 B |

The JavaScript comparison uses the benchmark runner's same-run merge-base build; its content hashes explain
the few-byte difference from the earlier fragment's baseline. LiveSession's implementation is 58,216 B gzip,
its namespace facade is 78 B, and the shared Edit/Live formatter chunk is 591 B. Live has 5,968 B below the
unchanged 128,856 B reserve, and 12,112 B below the 135,000 B limit. The ZIP has 23,272 B below its reserve.
Both trim targets still exceed 4 KiB. No budget, reserve or cap changes.

No parity golden changes: diagram, simulation, planning and export outputs stay identical. Keeping the
specialized read-only port avoids restoring the full document editor and losing the ZIP savings; sharing
its navigation helper prevents behavior drift without that extra code.
