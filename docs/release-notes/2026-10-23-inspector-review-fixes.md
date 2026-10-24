## Inspector review fixes (#265)

Reselecting the current segmented choice is now a no-op for clicks and keyboard input. Tuned circuit-breaker thresholds stay intact, and redundant selections preserve Undo and Redo history across all shared segmented controls.

Readout disclosure bodies now own their layout in the shared readout stylesheet. Live retains its zero-gap layout; Inspector spacing stays scoped to the Inspector.

Regression coverage mounts the real caller-override hook, checks tick-free rendering and host removal, and verifies retry growth and custom jitter persistence with Undo. No output parity goldens are intentionally changed.
