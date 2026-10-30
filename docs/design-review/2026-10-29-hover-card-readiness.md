## Scope

Test readiness only. No controls, copy, layout rules or interaction modes change.
The existing delete, Undo, focus recovery and unpinned-target assertions remain.

## Review

The tests wait for the camera controller's idle state before measuring the stroke
they click. Pinning uses the existing named header and requires the pinned state.
Undo still restores an unpinned target, with node snapshot readiness and camera
completion observed before the next hover. Quick-add still compares pointer and
keyboard picks; its existing result-readiness wait covers the reported failure.

No app state-machine rewrite is supported by the failure traces: both reported
hover-card failures occur before deletion. No chrome or vocabulary changes are
needed.
