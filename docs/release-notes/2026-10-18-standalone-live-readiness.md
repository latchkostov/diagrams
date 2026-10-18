## Standalone Live readiness

Live now clears its busy state after the session mounts even when its host does not supply an external
handle callback, including the Lab's keyboard preset. Session readiness also resets correctly when
leaving and re-entering Live. The optional host callback remains an observer.

A browser component regression covers initial readiness and re-entry without a host callback; before
the fix, it fails because the mounted session's toggle still reports `aria-busy="true"`.
No output parity goldens change.
