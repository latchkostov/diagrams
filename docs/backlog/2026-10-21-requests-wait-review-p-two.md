## PR #222 queued review follow-ups

The 2026-10-21 review has two remaining independent P2s:

- **KEDA resource targets** (`src/planning/AutoscalingFields.tsx`): selecting CPU or memory adds a 70% target but exposes only the broker target. Add a separately labelled metric target inside the existing Inspector disclosure, with CPU/memory/busy-thread units and browser coverage. This needs a control-layout review rather than being folded into the simulation accounting fixes.
- **CPU-limited busy-thread sizing** (`src/sim/resourcePlanning.ts`): the static target-replica estimate uses configured thread hold time and omits occupancy while CPU finishes. Include CPU-constrained execution and respect the CPU throughput ceiling. Pin the 100 requests/s, Concurrency 16, 10 ms local work, 40 CPU-ms/request, 1000m limit, 70% target case against playback before choosing the steady-state formula.

Duplicate broker-attribution findings are covered by the P1 source discriminator. Live metric units and inverse non-blocking busy-thread coverage are fixed in this review round.
