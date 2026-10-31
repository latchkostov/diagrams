## Preserve exact keyboard scrolling

Reviewed against UX-PRINCIPLES. Pointer wheels and Home, End and page keys retain their existing behavior. The verification driver waits until the current native input has been consumed before starting the next one. Scrolling still has to reach the exact top and existing bottom boundary; no user-facing control changes.
