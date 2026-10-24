## Scheduled bundle trim restores canvas and Live headroom

Optional editor and Live UI now download through registered lazy surfaces, with recovery outside
those chunks. Diagram behavior, simulation results, file/export content and fixed budgets stay
unchanged. No parity golden is intentionally changed.

Production `pnpm bench:bundle` measurements (gzip level 9):

| Group           |    Before |     After |   Saved | Fixed cap | Headroom after |
| --------------- | --------: | --------: | ------: | --------: | -------------: |
| canvasFirstView | 382,366 B | 374,634 B | 7,732 B | 383,000 B |        8,366 B |
| liveSession     | 134,616 B | 126,251 B | 8,365 B | 135,000 B |        8,749 B |

The composition report and a local HTML visualizer identified these modules. The table accounts
for the emitted gzip payload now outside the relevant initial request, grouped where modules
share a chunk. Chunk payloads are **not additive net savings**: shared dependencies and compression
change when the boundaries move. The before/after table is the net saving.

Node identity was already deferred before this trim. It is now consolidated into the node-panel
chunk to avoid a second download before naming; its bytes in that combined payload are not new savings.

| Deferred module(s) / moved code                                                                         | Emitted gzip bytes |
| ------------------------------------------------------------------------------------------------------- | -----------------: |
| `canvas/inspector/NodePanel.tsx`, `NodeIdentity.tsx`, `propertyValues.ts`                               |              2,733 |
| `canvas/inspector/simFields.ts`, `Disclosure.tsx`, `canvas/simFieldRules.ts`                            |              2,003 |
| `canvas/inspector/fields.tsx`, `sideLabel.ts`                                                           |              1,544 |
| `canvas/inspector/useNameFields.ts`                                                                     |                587 |
| `canvas/inspector/lazyPropsEditor.tsx`                                                                  |                613 |
| `planning/lazy.tsx`                                                                                     |              1,500 |
| `model/brokers.ts`                                                                                      |                596 |
| `stencils/brokerVocabulary.ts`                                                                          |                206 |
| `live/format.ts`                                                                                        |                595 |
| `canvas/PresenceLayer.tsx`, `canvas/NodeTooltip.tsx` (shared `CanvasReadouts` chunk)                    |              1,780 |
| `canvas/checks/ChecksMarkers.tsx`                                                                       |                896 |
| Menu row rendering from `components/ContextMenu.tsx` → `MenuList.tsx`                                   |              3,128 |
| Live overflow items from `live/ControlBar.tsx` → `LiveMoreItems.tsx`                                    |              1,499 |
| Analysis/fix code from `live/capacityModel.ts` → `capacityView.ts`                                      |              2,505 |
| `sim/capacity.ts`, `waitingPlan.ts`, `admissionPlanning.ts`, `resourcePlanning.ts`, `iterationBound.ts` |              8,271 |
| `sim/capacityPlanning.ts` analysis and sizing                                                           |              1,408 |
| `live/session/EditCapacity.tsx`                                                                         |                884 |

Playback's `sourceTraffic`, `withSizing` and sizing types move into `sim/capacityInputs.ts` to keep
the analyzer out of the playback input dependency chain. The interaction context is separated
from its React controller adapter so optional surfaces do not pull that adapter through the menu.
These small shared helpers remain available synchronously.

No minimap, simulation engine, particle renderer, next-node handle, copy confirmation, or first-paint playback controls were deferred:
they are needed immediately. The handle deferral introduced connection races under load; the copy confirmation must remain visible throughout its existing lifetime. The React compatibility-shim alias experiment was rejected because its gzip benefit was negligible. No vendor dependency replacement, output re-recording, budget increase,
or speculative asynchronous controller rewrite was needed.

The registry now omits test-driver module names and source paths in shipped builds while retaining
ids and export policies. Direct Node discovery keeps full metadata. Lazy placeholders derive their
existing test id from the surface id and omit redundant empty sizing objects. Menu matching and
early Enter/Escape execution remain in the eager shell; only its row renderer downloads later.

The production split regression fails on untrimmed origin/master. The full parity run reports
zero changed, added, missing or stale goldens. No golden was re-recorded. The initial full unit run
reported 10,236 passes and nine failures in two SSR inspector suites; both now preload the actual
node panel before server rendering, preserving every capability and translated-field assertion.
Their targeted reruns pass. The initial Linux load run exposed handoff/gesture failures; the eager
keyboard handoff and restored handle address them. A clean origin/master flow-building check passed
126 tests across two runs, with zero failures/flakes.

Further load and CI runs exposed a buffered-query/Enter race, navigation keys lost while plain
menu rows loaded, and a second identity download stealing focus. Search now commits its buffered
query before taking focus; the eager loading shell retains navigation for ordered replay; node
identity arrives with its panel. The two menu regressions fail with their fixes temporarily reverted.
The final targeted unit/SSR run passes all 194 tests. Output parity remains unchanged.

The final affected-spec Linux run passes 820 tests across five repetitions with 10 workers and
10 CPUs, with zero failures or flakes. The final Node parity recheck passes 1,855 tests and
3,016 goldens, with zero changed, added, missing or stale outputs.

The neighboring sweep passed 199 tests and exposed three held-chunk cases still intercepting the
removed identity chunk. They now hold the containing node-panel chunk instead, retaining every
typing, Enter, Escape and focus assertion.
The corrected inspector suite passes all five Linux repetitions at 12 workers/CPUs: 105 passed,
zero failed and zero flaky.
