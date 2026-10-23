## Interaction review

Restore the existing inspector naming contract: selected editable items keep Enter and F2, while a focused unselected item can pin Live details. Native controls own Enter. Escape closes any readout after higher-priority owners and restores anchor focus only for pinned cards; a hover dismissal leaves focus untouched.

Keep clickable cards, placing them around canvas overlays and their originating item with the existing free-space resolver. Expanded details use a shorter scroll area when overlays leave no full-height slot; a card with no available slot stays hidden instead of obstructing an action. Arrow navigation scrolls only the card, preserving the camera. No toolbar controls were added.

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
