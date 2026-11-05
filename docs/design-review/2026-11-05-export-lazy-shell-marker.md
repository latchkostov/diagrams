## Export shell marker audit

The shared `data-lazy-shell` convention replaces the exclusion class without
adding wrappers, controls, layout changes or download dependencies. It covers
default loading, retrying and failed shells, plus custom `DetailsLoading` node
and edge readouts. The filter accepts both HTML and SVG markers.

The canvas surface audit in `2026-11-05-export-lazy-placeholders.md` still applies:
edge reader/message-tip, frame detail, presence, node tips, check markers, calls,
threads, session and cache use the default shell. Node/edge details use the custom
readout shell. Edge shaping and the main renderer have null placeholders;
capacity analysis has a panel outside the captured viewport or returns null.
Other custom panel/dialog placeholders stay outside the capture viewport.

Rejected: importing a surface registry or implementation into the filter, waiting
for skip-policy tooltip downloads, and changing image goldens or bundle reserves.
The held-chunk SVG/PNG/HTML regression and golden byte checks remain intact.
