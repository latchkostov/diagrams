## UX review: deterministic CI

This batch changes test execution and engineering feedback. It adds no product controls, labels,
menus or settings and consumes no chrome budget. Operation probes are Vitest-only; production
bundles and diagram outputs must retain parity. The later e2e-clock work remains a separate change.

Keep the existing aggregate CI check names so contributors and merge tooling retain one familiar
gate. The flake classifier reports unknown failures explicitly and never authorizes a merge itself.
Consolidated load observations retain their original uncertainty and immutable evidence, instead
of implying that moving a test or observing a passing rerun fixes a product bug.

Rejected: wider timeouts, reduced simulation horizons/sample counts, retries, re-recorded goldens,
coverage on heavy simulations, and counting only the input length (which cannot detect nested scans).
Actual loop/callback probes catch scans introduced by regressions; native character/copy probes
also cover repeated serialization and trimming. Native regex internals retain timing companions.

## Deliberate regression checks

Each mutation was applied to actual implementation code, run against its converted guard, and
restored byte-for-byte. Failures came from operation counts, not timeouts or type errors.

| Family            | Deliberate regression                                                            | Rejection                                                      |
| ----------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Kubernetes reader | Match each Service against every workload instead of the indexed selector bucket | Exceeds 9x reader-work limit                                   |
| Geometry          | Replace line sorting with pairwise sorting                                       | Exceeds 24x operation limit                                    |
| Checks/topology   | Scan every node for each edge target instead of using the map                    | Exceeds 24x operation limit                                    |
| Report output     | Serialize every growing findings prefix                                          | Exceeds 24x character-work limit                               |
| Routing           | Re-scan all rules for each rule                                                  | Exceeds 24x operation limit                                    |
| Engine tick       | Scan all undrawn trips every tick                                                | 7.954x work, rejected by the existing constant-work limit of 3 |
| Import bounds     | Trim the whole reason before slicing it                                          | Rejected by the existing constant-work ratio                   |
| ID repair         | Restart suffix probing at 2 for every repeated ID                                | Exceeds 24x operation limit                                    |
| Live observation  | Scan all edges for every node                                                    | Exceeds 24x operation limit                                    |

The first Kubernetes mutation exposed masking by unrelated parser work. Warming its cache and
counting only the reader, with a strict linear ratio of 9, makes the same scan fail reliably.
Native regex timing companions retain their adversarial inputs and original thresholds.

## Converted checks

Thirty complexity checks now observe operations. The checkpoint-playback timing diagnostic runs
only in Benchmarks, preserving its native clone/serialization timing. Five
native-pattern checks also retain their timing companion in Benchmarks. Two identically titled
checks below are the separate batch 3 and batch 4 rule families.

| Spec                                   | Test title                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/ai/ondevice/compactOps.test.ts`   | a long adversarial request converts in linear time (native timing companion)                         |
| `src/ai/ondevice/requestEdits.test.ts` | stays linear on long adversarial input (native timing companion)                                     |
| `src/canvas/guides.test.ts`            | indexes nodes in n log n time                                                                        |
| `src/canvas/placement.test.ts`         | stops at its budget instead of blocking the page                                                     |
| `src/checks/examples.test.ts`          | checks a 1,500-node diagram in linear time, every rule                                               |
| `src/checks/examples.test.ts`          | the structural rules stay linear on a loop-rich 1,500-node diagram                                   |
| `src/checks/examples.test.ts`          | cycle detection stays linear in high fan-out: parallel requests and a hub                            |
| `src/checks/examples.test.ts`          | eight times the diagram (about 190 to 1,500 nodes) takes about eight times as long, never sixty-four |
| `src/checks/examples.test.ts`          | many starts into one shared chain, and many callers into one service, stay linear                    |
| `src/checks/examples.test.ts`          | eight times the diagram (about 190 to 1,500 nodes) takes about eight times as long, never sixty-four |
| `src/checks/report.test.ts`            | keeps the longest prefix of many findings, in linear time                                            |
| `src/editor/tidy.test.ts`              | stays fast on a large selection among many obstacles, even when it can't find room                   |
| `src/editor/tidy.test.ts`              | a thousand boxes aligned onto one spot spread in one pass                                            |
| `src/interop/checksRoundTrip.test.ts`  | reads only the first entries, so a hostile list costs no more than a full one                        |
| `src/interop/infra/hostile.test.ts`    | runs every pattern in linear time on adversarial input (native timing companion)                     |
| `src/interop/infra/kubernetes.test.ts` | finds each KafkaUser's workloads through an index, in linear time                                    |
| `src/interop/infra/kubernetes.test.ts` | runs its own patterns in linear time on adversarial input (native timing companion)                  |
| `src/interop/infra/kubernetes.test.ts` | reads documents in linear time                                                                       |
| `src/interop/infra/kubernetes.test.ts` | a chain of doubling variables stays small and fast                                                   |
| `src/interop/infra/kubernetes.test.ts` | resolves a host with no Service through an index, in linear time                                     |
| `src/interop/infra/terraform.test.ts`  | runs its own patterns in linear time on adversarial input (native timing companion)                  |
| `src/interop/infra/terraform.test.ts`  | deduplicates grants before expanding them across a role's users, in linear time                      |
| `src/interop/infra/tfScaling.test.ts`  | joins scaling resources in linear time                                                               |
| `src/interop/uniqueIds.test.ts`        | stays linear when a hostile file repeats one id, around suffixes the file uses itself                |
| `src/live/observedTrouble.test.ts`     | an observation is linear in the diagram, however many brokers have no dead-letter route              |
| `src/live/observedTrouble.test.ts`     | outage details stay linear with thousands of down consumers on one topic                             |
| `src/sim/drain.test.ts`                | a tick's work doesn't grow with the staged backlog                                                   |
| `src/sim/drain.test.ts`                | idle travel and drawing work stay constant with an eightfold undrawn burst                           |
| `src/sim/routeMatching.bounds.test.ts` | grows linearly in rules at a fixed message count, and in messages at a fixed rule count              |
| `src/sim/routeMatching.bounds.test.ts` | compiles and validates configuration linearly in its size                                            |
