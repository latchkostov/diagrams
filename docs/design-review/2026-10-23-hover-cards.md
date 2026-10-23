## Decision

Implement direction C's header, problem-first verdict, four vitals, two attention rows and three collapsed summaries. Pinning opens direction B's sectioned details. The fixed summary has no configured estimate or sparkline. No global toolbar control was added.

## Interaction and accessibility review

A designer-agent review checked the implementation against the UX principles and the owner decisions. Its findings were resolved: warning copy uses the existing contrast-safe ink; ArrowUp enters the last pinned section; resolved attention slots retain a label; unknown measurements do not publish zero-valued meters; configured details have an accurate pinned label; healthy section rails use kind accents rather than warning colours. Distinct keys reset row ordering on pin without duplicating content.

The interaction controller owns readout pinning, replacement, dismissal and Esc focus return. Enter takes precedence over inspector naming in Live, including selected nodes; F2 remains available from the node. Attention and section ordering freeze when the card opens and reset on pin, while numbers and status update in place. Pinned details are scrollable reading regions with keyboard section navigation. Their accessible name and the originating item's full description remain separate.

Cards use a screen-space portal above the diagram and its Live callouts, the existing theme tokens, striped problem meters, explicit symbols and text. Their screen size is independent of zoom. Presentation scales the readout to 1.3×. In short viewports, placement uses horizontal space and bounds the scroll region above the Live controls. Arabic, pseudolocalization and reduced motion have dedicated browser coverage.

The final designer review inspected all eight compact after screenshots and both pinned screenshots. It found no remaining blocking accessibility, clipping or overflow issue. The pinned Threads details are shown in [light](2026-10-23-hover-cards/pinned-threads-light.png) and [dark](2026-10-23-hover-cards/pinned-threads-dark.png).

## Screenshots

The same public scenarios and seek positions are captured before and after. The old connection case has no Live card.

| Case                      | Before light                                              | After light                                             | Before dark                                              | After dark                                             |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| Healthy service           | [Before](2026-10-23-hover-cards/before-healthy-light.png) | [After](2026-10-23-hover-cards/after-healthy-light.png) | [Before](2026-10-23-hover-cards/before-healthy-dark.png) | [After](2026-10-23-hover-cards/after-healthy-dark.png) |
| Exhausted threads         | [Before](2026-10-23-hover-cards/before-threads-light.png) | [After](2026-10-23-hover-cards/after-threads-light.png) | [Before](2026-10-23-hover-cards/before-threads-dark.png) | [After](2026-10-23-hover-cards/after-threads-dark.png) |
| Topic and consumer groups | [Before](2026-10-23-hover-cards/before-topic-light.png)   | [After](2026-10-23-hover-cards/after-topic-light.png)   | [Before](2026-10-23-hover-cards/before-topic-dark.png)   | [After](2026-10-23-hover-cards/after-topic-dark.png)   |
| Retrying connection       | [Before](2026-10-23-hover-cards/before-edge-light.png)    | [After](2026-10-23-hover-cards/after-edge-light.png)    | [Before](2026-10-23-hover-cards/before-edge-dark.png)    | [After](2026-10-23-hover-cards/after-edge-dark.png)    |

## Verification

The new ten-second bounding-box test was run against the original card implementation and failed on its dimensions (approximately 316 × 432 pixels in that run). It passes on the fixed 320 × 332 frame. Additional tests cover pinning, selected-node Enter, edge lines and pills, Esc focus return, bounded sample history, read-only views, localization, and a held/failed detail download with CSS, cursor, focus, export and Retry available outside the deferred chunk.

The new production spec passed three times (30 tests). Targeted readout, summary, controller and existing badge/pill unit tests passed. The affected browser suites and axe checks passed after migrating explicit expanded-detail expectations; the narration regression additionally closes its pinned card with Esc before using Continue, checking focus return. Bundle benchmarks passed all four gates: entry 108.3 kB gzip, startup 176.8 kB, canvas first view 382.5 kB. Size checks passed without budget increases.

The full parity comparison checked 3,080 goldens: only the catalog metadata changed for 84 new hover messages. The focused i18n comparison passed after that deliberate update. All browser render and other output goldens stayed unchanged.

The initial native full unit run reported 19 failures. Five feature-related failures were fixed and their targeted tests pass. Fourteen remaining results were five-second native timeouts; focused clean-master runs reproduced five and three timeout failures respectively. See the [follow-up](../backlog/2026-10-23-native-unit-timeouts.md) for the exact scope and evidence. This is not a claim that the initial full unit suite passed.

## Rejected alternatives

No live re-sorting, measured-height compact/summary flags, always-visible sparklines, extra toolbar buttons, or bundle-budget increases. Breaker state remains explicitly unavailable until #245 supplies it.
