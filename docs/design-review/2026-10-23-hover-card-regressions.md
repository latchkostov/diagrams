## Interaction review

Restore the existing inspector naming contract: selected editable items keep Enter and F2, while a focused unselected item can pin Live details. Native controls own Enter. Escape closes any readout after higher-priority owners and restores anchor focus only for pinned cards; a hover dismissal leaves focus untouched.

Keep clickable cards, placing them around canvas overlays and their originating item with the existing free-space resolver. Expanded details use a shorter scroll area when overlays leave no full-height slot; an unpinned summary with no available slot stays hidden instead of obstructing an action. A pinned card was asked for and may hold focus, so it stays visible at its compact, scrolling height. Arrow navigation scrolls only the card, preserving the camera. No toolbar controls were added.

## Readout accuracy and accessibility

Resolve simulation connection overrides once for node badges, edge cards and node sections. Preserve absent request and success counters as unavailable, distinct from a measured zero. Red problem text uses dedicated light and dark inks, with axe coverage of an exhausted-thread card in both themes.

## Scope decisions

Keep the queued edge-kind semantics, malformed-ID handling and hover subscription/performance findings for their own rounds. Do not loosen the two failing CI specs, timeouts, retries or bundle budgets. Existing Enter pin coverage now starts from an unselected focused node, matching the restored selected-item naming contract.

## Regression evidence

With the runtime fixes temporarily reverted, the production browser run failed the new unpinned Escape, simulation caller override, section reveal and light-theme problem contrast cases. The focused unit run also failed unavailable-rate, hover-dismissal focus, readout ownership and nested-control activation assertions. Restoring the fixes preserves the unchanged CI naming and DLQ tests. No timeout, retry or budget was increased.

The first Linux load pass exposed an additional obstruction in the unchanged inspector spec: overlay avoidance displaced an unpinned card onto its own node. The originating item is now an obstacle too, preserving its right-click target. The inspector, hover-card and simulation-truth specs pass after that correction.

A selected-node regression additionally caught listener ordering after the lazy Live session mounts: the canvas had already queued selection clearing before the readout consumed Escape. Canvas Escape handling now yields while a readout is open, leaving the shared Live key policy to choose its owner. The regression first failed with the node unexpectedly deselected.

Preserve the existing waiting-narration contract covered by the unchanged Live tests: Enter on a focused node or connection pins details while naming is unavailable; Continue (or Enter on the canvas) resumes narration. Selected editable items keep Enter naming when no narration waits, and native controls always retain activation. A production reproduction first showed the incorrect resume (`playing`, unpinned), so this context is explicitly covered by the key policy.

The shared expanded-details test helper now pins through the card header instead of assuming Enter pins an already selected item. This preserves the restored naming contract without relaxing any content, focus or geometry assertion. Dedicated keyboard tests still cover unselected Enter, selected naming, waiting-narration pinning and native-control activation.

## Round 3: keyboard order, honest connections

Cards are portalled outside the canvas, so Tab used to leave canvas navigation after entering one. Live's readout layer (src/canvas/interaction/readoutLayer.ts) now bridges them through the interaction controller: node, card, next node, and back with Shift+Tab; a pinned card's sections are ordinary Tab stops before the next node, and leaving releases the pin so the next node's summary can show. An unpinned summary stays a single stop: its rows are reached with the arrow keys or by pinning it, which Enter now does. The layer ships with Live, keeping the canvas first view within its budget, and hovering re-renders only the readout layer.

Connection cards show caller semantics only for active Requests in models where callers wait. Message flows show deliveries and what is in flight, with no fabricated thread or retry figures; dependencies say they carry nothing. The breaker section and verdict use the published runtime state through one readout shared with the node's Calls section. Loss counts drops only; dead-letter transfers are listed apart. The sparkline is described by a visible now/low/peak line and a screen-reader list of its values.

Placement protects a waiting narration's Continue, and a pinned card stays visible even without a free slot. A focused control's own open tooltip (the dependency list) owns Esc before the card. No toolbar controls or budget increases.
