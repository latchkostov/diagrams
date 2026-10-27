## Preserve canvas first-view headroom

Keep the Live rail hints and zoom controls within the existing canvas reserve. Native button titles provide the rail's accessible descriptions without hidden copies and generated IDs. The Lab's fallback history strip stays in development and E2E builds; the app bezel continues to own Undo and Redo. The bezel's history buttons share their rendering code.

No surface moves to a new lazy chunk, no budget or reserve changes, and this fix changes no parity goldens. The earlier rail change's intentional catalog golden update is explained in `2026-10-27-rail-live-chevron.md`.
