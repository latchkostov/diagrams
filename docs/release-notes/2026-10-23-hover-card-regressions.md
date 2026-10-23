## Hover cards preserve canvas actions

Live keeps Enter naming for a selected editable node, boundary or connection. Enter on a focused unselected item pins its readout; nested controls retain their own activation. While narration waits, Enter on a focused node keeps pinning details; Continue resumes playback. Escape dismisses either kind of card, without reopening it until its originating item is left, and recordings, editors and panels keep their keyboard priority.

Cards reserve space for canvas controls and callouts, including the loss callout's Add dead-letter queue action. Expanded cards scroll when that space is limited; arrow navigation reveals the focused section without moving the canvas.

Request and goodput windows that were not measured show “—”. Cards, node sections and call pills share the running simulation's connection overrides. Problem status and attention text use contrast-safe red ink in both themes.

## Output parity

The rebase preserves the upstream circuit-breaker and vendor-stencil keys and regenerates only `node/i18n/catalogs.json` for the hover redesign's 96 English messages and their translation fallback counts. Simulation results, rendered diagrams and exported outputs are unchanged.

## Keyboard and connection cards

Tab now crosses Live cards in the canvas's reading order: a node, its card, then the next node; Shift+Tab retraces the same steps, opening the previous node's card. In a pinned card Tab visits each section and then moves on to the next node. Enter pins a summary reached with Tab.

Connection cards describe what the connection is. Only a Request whose caller waits shows threads, timeouts, retries and the breaker; messages show deliveries, and dependencies say no traffic flows. Dead-lettered messages are no longer counted as lost. The pinned throughput history also reads as text: now, low and peak, and every sampled value.

A pinned card stays readable in a short viewport, a waiting narration's Continue stays clear of hover cards, and Esc closes a focused node's dependency list before its card.
