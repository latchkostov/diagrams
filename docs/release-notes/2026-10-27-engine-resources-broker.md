## Engine split: resources and broker (3/5)

Mechanically extracts broker ownership, staging, dispatch and return handling into
`src/sim/engine/broker.ts`, and fleet/controller support, CPU budgets and tails, resource
integration and autoscaling into `src/sim/engine/resources.ts`. The facade retains the ordered
tick and service loop. Simulation revisions and serialized formats stay unchanged.

The new boundaries use positional callbacks and typed tuples, read restored roots through
accessors, and keep pre-service occupancy and both CPU-tail charging positions. The import-boundary
check explicitly includes both modules. A characterization test pins per-tick resource accounting
and broker dispatch order across pause/resume, replica/scale edits and repeated checkpoint replay;
dispatch-order and occupancy mutations both fail it.

The existing execution-reservation adapter also uses positional inputs and a typed tuple of returned
functions. This follows the design's instruction to reduce adapter overhead within the PR, keeping
the extraction within its size limits. All 12 execution bodies and 31 moved helper bodies retain
their tokens after normalizing accessor wiring. No cohort data fields are renamed.

### Source map against ed765d464369863a5d37a903127720d534ee835c

| Module                                | Original `src/sim/engine.ts` lines                           |
| ------------------------------------- | ------------------------------------------------------------ |
| Broker                                | 774–780; 808–952; 1209–1267; 1863–1883; 2227–2249; 2847–2989 |
| Resource support and CPU charging     | 2991–3065; 3308–3371                                         |
| Fleet advance                         | 3380–3384                                                    |
| CPU preparation and first tail charge | 3443–3541                                                    |
| Second tail charge                    | 3605–3618                                                    |
| Integration and autoscaling           | 3619–3688                                                    |

### Output parity and sizes

Node parity compares 3,045 goldens and full parity compares 3,178, each with zero changed, added,
missing or stale goldens. No golden was re-recorded. The generated viewer changes only compiled code.

| Payload                                                     | Raw delta | Gzip delta |   Head gzip |
| ----------------------------------------------------------- | --------: | ---------: | ----------: |
| LiveSession chunk                                           |       0 B |       +4 B |    56,572 B |
| LiveSession and its static imports beyond the loaded canvas |     +22 B |      +31 B |   134,996 B |
| Simulation                                                  |     +22 B |      +25 B |    43,182 B |
| Simulation worker                                           |     +53 B |     +193 B |   124,441 B |
| Evidence worker                                             |     +60 B |     +144 B |   126,495 B |
| Viewer JavaScript                                           |     +68 B |      +38 B |   522,038 B |
| All app JavaScript, including worker assets                 |    +135 B |     +467 B | 4,547,005 B |

These meet the +200 B per-payload and +1,000 B total gzip limits. The actual skill ZIP is
833,609 B, 93 B above the merge-base and 1,391 B below the unchanged 835,000 B cap.
No budget or compression policy was changed. Live's fixed 135,000 B budget has 4 B headroom;
[the dedicated trim follow-up](../backlog/2026-10-27-engine-split-live-headroom.md) records that warning.

### Verification limitation

The full Linux gate passed all unit/heavy tests and parity but reported seven browser failures.
Clean-master probes of the affected files passed twice (402 tests), and the implementation's
line-targeted probe passed all nine selected cases. The failures remain unexplained, not established
as pre-existing. [The browser follow-up](../backlog/2026-10-27-engine-split-e2e-probe.md) records the
exact summaries and requires investigation using PR CI before merge.
