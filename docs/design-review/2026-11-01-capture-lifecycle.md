## Image capture lifecycle

No controls, wording, colours, camera policy or export layout change. A newly mounted detail surface
stays suspended until capture ends, then restores its normal low-zoom rendering. Existing surfaces
still restore the natural drawing before capture measures it. Nested captures keep their existing
ownership and cancellation behavior.

The regression mounts the actual chip surface from a React effect during capture and checks both
the natural capture state and resumed chips. Silencing console errors or delaying every export
with a fixed sleep was rejected: the error identifies an invalid lifecycle call.
