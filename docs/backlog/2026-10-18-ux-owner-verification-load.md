## Unit timeouts under concurrent verification load

The owner-decisions branch's complete `pnpm test --maxWorkers=2` run reported 11,172 passed, six failed and 12 skipped. All six runtime failures were existing five-second hang-backstop timeouts:

- `src/collab/recovery.test.ts`: merge another tab's encrypted journal without rereading the 5,000-node checkpoint.
- `src/bench/workloads/workloads.test.ts`: deterministic k8s workload at 500 nodes.
- `src/lib/portableModifiers.test.ts`: portable E2E primary-modifier lint.
- `src/interop/infra/compose.test.ts`: refuse a graph over the connection budget.
- `src/collab/transport/tracker.test.ts`: three clients and a rejoin, seed 3.
- `src/collab/transport/memory.test.ts`: three clients with injected faults and a rejoin, seed 1.

Clean source snapshot: origin/master `da6b7176d85c73b86dde581a6ca55e814256bf71`, exported inside this checkout's ignored test-output directory. Only the failing spec files were run, twice; no full master gate was run. The first five specs gave `Tests 3 failed | 176 passed (179)` then `Tests 8 failed | 171 passed (179)`. The same recovery/workload/modifier timeouts reproduced; the second run also reproduced the Compose timeout and tracker seeds 1–4, including seed 3. Memory separately gave `Tests 17 passed (17)` then `Tests 2 failed | 15 passed (17)`, reproducing seed 1 (and seed 2). Runtime failure messages were the same five-second backstop timeouts as this branch.

The source snapshot reused this checkout's installed runtime dependencies. Its typecheck reported 22 missing nested server dependency diagnostics because that archive has no separately installed server dependencies; those diagnostics are not claimed as baseline product failures. Memory's two runs disabled typechecking and compared runtime behavior only.

Do not extend timeouts or weaken assertions in this UX change. Investigate the shared-host verification load and these existing backstops separately. Logs remain under `tests/.output/owner-{all-unit,master-1,master-2,master-memory-1,master-memory-2}.log` locally.

The five-repeat Linux UI-neighbor gate exited busy (75) after its bounded admission wait; a different live gate held the entire shared worker budget. No locks were removed and no load repeat ran.
