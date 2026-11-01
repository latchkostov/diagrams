## Product cause

Dispatched Nightly 41267020590 at 7fc2488ed reports Windows lowzoom-chips.spec.ts's worker paint count increasing from four to five after its FIFO readback barrier, with the same 160 particles. The worker has an independent asynchronous draw path: loadCanvasFonts invalidates and immediately repaints its last frame. The main loop stops supplying frames below 60%, but cannot prevent that late callback from painting the hidden layer.

Font completion now posts an epoch-scoped invalidation to the existing frame loop. That loop retains the request across an in-flight acknowledgement and sends the next frame only when ordinary drawing resumes. Visible paused drawings still render once; low-zoom canvases remain idle. No new visibility mode, paint-count allowance, timeout, tolerance or skip is introduced. The November 1 review follow-up removes the unused legacy repaint protocol and explicitly covers actual drawing with unchanged paused inputs.

## Regression evidence

The real worker module is driven with a held font promise. Releasing it must request invalidation without changing actual drawing calls or frame counts; the next supplied view draws normally. A facade regression checks the pending frame, old-attachment epoch, unchanged paused snapshot and acknowledgement interleaving. Restoring the independent draw and removing the invalidation condition makes both new cases fail. All 31 affected worker/protocol/facade units pass with the fix.

The original native failure is retained as before evidence. Linux low-zoom and renderer specs run twice with full parity, build, size and the startup/reserve heavy cases. Final counts and the newly dispatched head's native inventory are recorded in PR #411 and the round-five verification fragment. This product scheduling repair is separate from the unresolved cumulative SVG export work.
