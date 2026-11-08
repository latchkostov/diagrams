## Mesh editing cost after canvas frame captions

The #446 final fix restores connection-label access and retains R-8ae6e39a94's settled indexes.
The master comparison still finds a material editing cost on the 500-node mesh. Investigate this
separately; do not remove the caption fallback, revert the indexes or loosen interaction assertions.

[Same-job benchmark comparison](https://github.com/latchkostov/diagrams/actions/runs/42434891745):
base `3e4b9305018249be40eefafc47ce2d043ccbdd03`, head
`cfd743dcca60dad28736747adfa3279b150fc3a9`, full mode, one browser worker, CPU throttle 2,
three samples per workload on the same runner. Every gate passes; the comparison reports no changed
counts or size growth.
The comparison identifies six report-only timing regressions beyond its noise allowance, all on the mesh.

Name-edit main-thread CPU is 251.71 to 396.20 ms/key (+57.4% raw, about +60% after calibration).
Subtitle and number CPU per key also increase (about +81% and +80% after calibration). The other
three flagged metrics are subtitle input-to-paint, zoom input-to-paint and name-edit longest frame.
The input-to-paint metrics have much wider sample variation; preserve their distributions when profiling.

Pan/zoom CPU medians are slightly lower on all measured workloads. Pipeline name editing is
129.18 to 124.49 ms/key at 500 nodes and 340.22 to 306.49 at 1,500 nodes. This is a mesh-specific
finding, not evidence that the caption changes make every editing workload slower.

Profile the complete name/subtitle/number edit and frame-settlement work against master, including
caption measurement and collision queries, rather than only React render counts. Keep the same
workloads and same-job comparison; timings remain report-only. The deterministic caption-index guard
still measures 8.11x operations for eightfold input under its unchanged 24x limit.
