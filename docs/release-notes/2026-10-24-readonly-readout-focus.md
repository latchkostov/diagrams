## Read-only Live keyboard traversal

Embedded and exported Live viewers now keep one canvas Tab stop while navigating readouts, so Tab and Shift+Tab leave the canvas at either end even when document order differs from reading order. Readout eligibility caches canvas membership between topology edits instead of rebuilding it on each Live publication. Regression coverage also verifies canvas focus recovery when a focused node or edge readout's target is deleted, and unpinned restoration on Undo.

No output goldens changed.
