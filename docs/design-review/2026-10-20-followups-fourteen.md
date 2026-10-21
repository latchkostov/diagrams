## Shape geometry and keyboard continuity

The designer-agent review checked the changed implementation against the UX principles. Shared
attachment geometry, readable label areas, collapsed shape catalogs and gesture-scoped modifiers
improve consistency without adding chrome. The review found two additional focus gaps: finishing
buffered annotation text and direct palette shape search. Both now use the existing focus controller
to hand keyboard interaction to the new shape; regressions cover immediate Enter afterward.

The reviewer also identified a pointer risk when a destination preview changes size. Quick-add now
reserves room for both planned destinations once, while the visible outline follows the highlighted
destination. Pointer traversal through Shapes, category and leaf checks that the root menu stays put.

No extra toolbar controls, host-dependent test assumptions or relaxed assertions were needed. Keeping
rectangular attachment points, preserving a non-square initial ratio under Shift, and moving an open
menu under the pointer were rejected because they disagree with visible geometry or established gestures.

## Export contract test ownership

The full Linux matrix exposed an export-contract test checking a transient notification after filesystem
persistence. The test now holds its page clock during that test-only I/O and resumes before importing
or reloading. Both notification assertions and every complete-file comparison remain intact. The
clock-controlled spec passed three Linux runs (126 cases) under concurrent load. Clean master passed
the original spec twice, so the failure was fixed rather than waived as pre-existing.
