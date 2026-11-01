## Latency details and review follow-ups

The Live-details browser driver now waits for the camera and viewport work caused by focusing its node before
pinning the card. The earlier wait preceded focus. In the #404 attempt-two trace, focus starts a
pan while the card briefly keeps its old position; the header moves during the click and remains
unpinned. A controlled regression covers pending and animating camera work, plus a changing viewport
whose camera marker is already idle, without timers or retries.
Application behavior, engine code, layout, budgets and reserves are unchanged.

Additional coverage verifies unordered, skewed benchmark medians; completion of asynchronous observer
clearing before GC; native E2E matrix shard bindings; clicking Simulation while a name field still
owns focus; and palette identity retention after reordering, refreshed callbacks and removal. Artwork
request counting now includes dev image URLs, excludes module imports, and runs against both servers.

## Already resolved on master

- #383 R-468b6a0282: `panScale.bench.ts` resets the workload with `prepare(true)` before Live.
- #383 R-a436ea05b3: `IdentityDetail` distinguishes input pans from camera-owned pans and fits
  synchronously at completion, including the existing custom-view regression.
- #385 R-36cb759122 and R-f4760c9d19: the survey requires both simulations' completed UI result and
  clears observer history before every heap reading, including the warmed baseline.
- #387 R-aafe07b907 and R-0380eedc01: the workflow preserves comparison tools from its own revision;
  tests isolate every action/size group and reject partially missing, undersampled or invalid groups.
- #389 R-6bd3c7b44f: `image-resources.spec.ts` already exercises actual PNG font/background/mask embedding.
- #392 R-c032d9e395: `mountChips.test.ts` asserts rendered subscriber content in the readiness-clearing
  frame, before an awaited microtask can hide an early publication.

## Deferred

#397 R-424baed559 changes dependency layout geometry. It remains deferred during Linux stabilization;
the separate backlog fragment describes the required packing contract and verification.

## Verification and output parity

The original latency stress baseline passes presentation 30/30 and embed 30/30 at six workers/three
CPUs. The controlled focus-pan regression fails 3/3 without the new waits and passes 3/3 with them.
These establish a causal guard, not a measured improvement from a nonzero natural failure rate.
Final Linux results and all negative controls are recorded in the design review.
The final branch cohorts pass **214/214** (two repetitions) and **60/60** (30 per latency surface).
Two artwork-readiness failures under the harsher two-CPU load reproduce identically in both clean
master repetitions and remain in a separate backlog fragment; their assertions and limits stay intact.

`pnpm parity`: **3,178 goldens, 0 changed, 0 added, 0 missing, 0 stale**. No golden was re-recorded.
