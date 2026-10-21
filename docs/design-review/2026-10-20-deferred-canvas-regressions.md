## Deferred canvas download review

Reviewed against the UX principles: no controls or chrome added. Boundary rename keeps the existing Label focus and text-selection contract after a cold download. Export keeps its existing progress, Cancel and error flow while waiting for the actual shape and its routes, so downloaded pictures match the canvas. Moving selections reuses unchanged handle geometry.

Rejected exporting rectangular placeholders after a failed download, and treating geometry publication as a document edit. Readiness and capture revision checks cover runtime geometry directly without adding undo history or dirtying the diagram. The other deferred inspector panels already notify the interaction controller and need no changes.
