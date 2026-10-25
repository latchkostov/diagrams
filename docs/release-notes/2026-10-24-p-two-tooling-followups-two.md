## Tooling follow-ups: hot replacement and shutdown coverage

Lazy-surface hot replacement now prunes inactive retired generations on every registration, keeping
development sessions bounded even when no export or Retry action queries readiness. Mounted older
generations still participate in output readiness until their consumers unmount.

A dev-server integration regression starts a ZIP download, holds the actual compression worker,
closes Vite and verifies worker exit and MessagePort handle release. Existing shutdown cancellation
already satisfies this contract; no compressor or archive-format change was necessary.

Request-timeout browser tests now wait for rename focus to finish before opening Simulation, then
wait for the lazy call-settings surface to report loaded and active before editing. A held-chunk
regression covers that readiness boundary. Validation, clearing and undo assertions are unchanged.

No output goldens changed: the runtime change is development-only, with no intended output change.
