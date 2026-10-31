## Tutorial-port fixture readiness

The lesson intro can close before the canvas host registers its document observation source. Publishing at that boundary produced No Lab canvas on Linux Dev. Starting file operations without a document source also left the held-parser cancellation tests without an origin to cancel.

The Lab probe now exposes a read-only readiness signal from currentObservationSource. The shared port setup waits for that real registration before publishing or starting operations. A held-CanvasView regression proves setup cannot return while the source is absent; removing the wait makes it fail. All 19 port e2e cases pass on Windows, including replacement/restart cancellation; 19 relevant observation units pass. One earlier gate used a nonexistent unit filename and exited 1 (its 19 e2e cases still passed); the corrected targeted unit run is green. No production behavior or golden changes are expected.
