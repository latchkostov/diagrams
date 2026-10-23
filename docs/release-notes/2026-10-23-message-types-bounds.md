## Message types stay responsive and loop findings stay bounded

The Simulation inspector now computes message propagation after edits settle, in idle time, retaining its previous
result while updating. Naming pauses analysis; ordinary labels, latency and other non-forwarding settings reuse
the shared propagation cache. Labels still invalidate implicit source or saved-injection types, and inferred dead-letter
routes still update when names or subtitles change their meaning.

Loop checks truncate displayed type and node names with an ellipsis, including their translated-message metadata.
A shared output-character ceiling is reserved before building each loop finding; omitted findings are counted in
the existing Checks summary. Authored names and message types remain intact.

No parity goldens are expected to change: existing loop findings use short names and fit the output budget.
