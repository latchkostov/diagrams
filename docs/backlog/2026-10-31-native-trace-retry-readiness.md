## Same producer, another consumer

Nightly 41269956615 at 545ed2bb1 reports macOS live.trace's generated held-chunk/Retry contract reaching its final non-body-focus assertion while the keyboard is still on the body. The earlier helper acknowledged this producer boundary only for canvas.presence. Loaded chunk state is earlier than Toaster's real focus-return frame for trace too.

The shared helper now retains presence's exact invoker assertion and acknowledges the existing non-body-focus contract for the remaining surfaces. The original generated assertion remains unchanged. The controlled return-frame regression covers both presence and trace, requiring preparation to remain pending after real chunk completion and toast removal, then the actual picker focus after release.

## Verification

All four constrained Windows executions pass. Temporarily removing only the new acknowledgement makes trace's held-return assertion fail; presence keeps its existing exact focus guard. The full lazy-surface spec runs twice in the pinned Linux container. The product source is unchanged from the freshly checked font scheduling repair: 31 renderer/protocol units, all 30 reserve heavy cases, build, size and all 3,178 unchanged parity goldens pass. No timeout, tolerance, retry, skip, quarantine or output golden changes.

The completed Windows inventory from the earlier dispatched head and its partial macOS/Linux counts are diagnostic evidence only. PR #411 records the final dispatched SHA and full per-OS inventory, with incomplete diagnostics explicitly separated.
