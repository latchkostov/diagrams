## Review

The designer review found no blocking UX issues. Latency paging keeps keyboard focus and a
one-eighth-page overlap for reading context. Wheel scrolling and Shift+Tab retain their existing
meaning. No controls or other chrome are added.

Automatic gallery playback is limited to untouched examples. Edited diagrams enter free play;
explicit simulation selection still authorizes narrated close-ups. Tests cover both paths.
The offline viewer keeps the same English stencil words while avoiding duplicated lookup tables.

## Rejected alternatives

Do not raise the zip budget: duplicate English metadata and an unused editor loader can be removed.
Do not force the camera back to the whole diagram during narration: that would break the intended
focus policy. Prevent the unsolicited narration when starting an edited example instead.
Do not loosen the bottom-of-scroll assertion or add waits: the reading region owns its paging keys.
Extra scrolling buttons would add chrome without making keyboard or wheel behavior reliable.
