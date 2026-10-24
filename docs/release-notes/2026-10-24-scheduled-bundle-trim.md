## Scheduled bundle trim restores startup headroom

Optional editor and Live UI now download through registered lazy surfaces, with recovery outside
those chunks. Diagram behavior, simulation results, file/export content and fixed budgets stay
unchanged. No parity golden is intentionally changed.

Production `pnpm bench:bundle` measurements (gzip level 9):

| Group           |    Before |     After |   Saved | Fixed cap | Headroom after |
| --------------- | --------: | --------: | ------: | --------: | -------------: |
| canvasFirstView | 382,366 B | 374,564 B | 7,802 B | 383,000 B |        8,436 B |
| liveSession     | 134,616 B | 126,247 B | 8,369 B | 135,000 B |        8,753 B |

The composition report and a local HTML visualizer identified these modules. The table accounts
for the emitted gzip payload now outside the relevant initial request, grouped where modules
share a chunk. Chunk payloads are **not additive net savings**: shared dependencies and compression
change when the boundaries move. The before/after table is the net saving.

| Deferred module(s) / moved code                                                                         | Emitted gzip bytes |
| ------------------------------------------------------------------------------------------------------- | -----------------: |
| `canvas/inspector/NodePanel.tsx`, `lazyNodeIdentity.tsx`, `propertyValues.ts`                           |              2,130 |
| `canvas/inspector/simFields.ts`, `Disclosure.tsx`, `canvas/simFieldRules.ts`                            |              2,002 |
| `canvas/inspector/fields.tsx`, `sideLabel.ts`                                                           |              1,543 |
| `canvas/inspector/useNameFields.ts`                                                                     |                588 |
| `canvas/inspector/lazyPropsEditor.tsx`                                                                  |                613 |
| `planning/lazy.tsx`                                                                                     |              1,501 |
| `model/brokers.ts`                                                                                      |                596 |
| `stencils/brokerVocabulary.ts`                                                                          |                206 |
| `live/format.ts`                                                                                        |                594 |
| `canvas/PresenceLayer.tsx`, `canvas/NodeTooltip.tsx` (shared `CanvasReadouts` chunk)                    |              1,779 |
| `canvas/checks/ChecksMarkers.tsx`                                                                       |                894 |
| Menu row rendering from `components/ContextMenu.tsx` → `MenuList.tsx`                                   |              2,984 |
| Live overflow items from `live/ControlBar.tsx` → `LiveMoreItems.tsx`                                    |              1,497 |
| Analysis/fix code from `live/capacityModel.ts` → `capacityView.ts`                                      |              2,502 |
| `sim/capacity.ts`, `waitingPlan.ts`, `admissionPlanning.ts`, `resourcePlanning.ts`, `iterationBound.ts` |              8,272 |
| `sim/capacityPlanning.ts` analysis and sizing                                                           |              1,413 |
| `live/session/EditCapacity.tsx`                                                                         |                880 |

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
