## Scope and UX review

No controls, copy, inspector fields, examples, simulation algorithms or scheduling phases are added. Live keeps
the existing message order, particles, event ring, counters, latency, tracing and replay behavior. The chrome
budget is unchanged. Existing replay anchors and both parity tiers protect this contract; the additional replay
characterization compares every suffix step's snapshot, frame, lossless events, metrics, configuration, trace and
RNG draw count across repeated restores, including an overflowing event ring.

## Mechanical source map

Ranges refer to `src/sim/engine.ts` at `a2506160a5177ec55ab46a5a44b937ac9d695303`, including whitespace.
The extraction moves 648 physical source lines: 354 to `model.ts` and 294 to `accounting.ts`.

| Original range             | Destination            | Preserved names / responsibility                                                                                | Lines |
| -------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- | ----: |
| 173–483                    | `engine/model.ts`      | Graph declarations and `isBroker`                                                                               |   311 |
| 3343–3348                  | `engine/model.ts`      | `DeliveryPart`                                                                                                  |     6 |
| 3452–3475                  | `engine/model.ts`      | `liveWork`, `nodeWork`, `queuedWork`; explicit group index                                                      |    24 |
| 3528–3540                  | `engine/model.ts`      | `resourceWork`                                                                                                  |    13 |
| 768–934, excluding 871–876 | `engine/accounting.ts` | `log`, `processed`, `step`, `gone`, `countRoute`, `addressed`, `creditRoute`, `copy`, `fanOut`, `drop`, `block` |   161 |
| 1108–1120                  | `engine/accounting.ts` | `topWaiting`                                                                                                    |    13 |
| 2149–2158                  | `engine/accounting.ts` | `retryWindowView`                                                                                               |    10 |
| 4211–4212                  | `engine/accounting.ts` | Existing throughput expressions in `finishTickMetrics`, called at the original site                             |     2 |
| 4857–4947                  | `engine/accounting.ts` | `frame`                                                                                                         |    91 |
| 4965–4981                  | `engine/accounting.ts` | `snapshot`                                                                                                      |    17 |

The facade retains `spend`, source allocation, lineage creation/live-message lookup, occupancy queries and other
public queries. Accounting receives only its graph slice, live scalar/root accessors and named synchronous
budget/event/readout queries. Checkpoints retain their original data graph and scalar lists; no functions or
scratch guards are added to persisted state. Every replaceable root is read through an accessor after restore.

## Rejected alternatives

Do not split the tick loop, add a catch-all engine context, buffer synchronous effects, rename cohort-related
functions, change compression settings or re-record goldens. Those would obscure the ordering or equivalence
contract. Moving additional public queries was rejected because it added ports and bundle bytes outside the
listed frame/snapshot seam. Replacing facade scalar variables with a shared mutable object was also rejected:
it enlarged the wiring diff and worsened measured bundle size.

## Production artifact measurements

Against the source-map baseline above, using real production builds and gzip level 9 per JavaScript file:

| Payload                                                            |  Base raw / gzip bytes | Extracted raw / gzip bytes | Raw / gzip delta |
| ------------------------------------------------------------------ | ---------------------: | -------------------------: | ---------------: |
| All app JavaScript, including both simulation workers              | 10,363,248 / 3,364,721 |     10,367,359 / 3,367,805 |  +4,111 / +3,084 |
| Full static LiveSession JavaScript import closure, each chunk once |    1,480,549 / 496,227 |        1,481,874 / 496,924 |    +1,325 / +697 |
| Viewer manifest JavaScript                                         |    1,561,185 / 510,486 |        1,562,574 / 511,141 |    +1,389 / +655 |

The entry, viewer and Forge budgets pass unchanged. The rebuilt skill ZIP is 817,129 bytes, 17,871 bytes below
the strict 835,000-byte ceiling. Startup-chunk and actual ZIP tests pass. LiveSession and viewer meet the design's
+1,000 gzip-byte allowance; the total app exceeds it by 2,084 bytes because the engine also ships in two workers.
The total-app acceptance item remains unresolved; no budget or compression policy has been changed to hide it.
