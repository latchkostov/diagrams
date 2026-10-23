## Hover cards: problem-first summaries and pinned details

Live node and connection cards now open with a name, stencil, status and a verdict, followed by four vitals, two reserved attention rows and three detail summaries. Compact cards stay 320 × 332 screen pixels at ordinary view size instead of changing shape with Simulation values. Presentation uses a larger readout; short viewports scroll and place cards beside the item when necessary.

Enter on a focused node or connection, or a click on its card, pins the card. Its section rows disclose the full readouts with accent rails. Arrow keys navigate those rows; Esc closes the card and returns focus to its item. A click elsewhere dismisses it. Canvas clicks retain particle tracing.

Configured estimates, full outcomes and bounded throughput sparklines live in pinned details. Editing tooltips adopt the lighter matching frame. Embeds, the HTML viewer and presentation retain the same reading controls without suggesting unavailable Properties panels. The Lab's “Live: problem-first hover cards” preset reuses four public examples.

## Breaker integration

A Request connection's card reads the circuit breaker's runtime state as the engine publishes it: Closed, Open with its countdown, or Testing with its test calls. An open or testing breaker leads the card's verdict, and the node's Calls readout shows the same state. Models that don't simulate breakers say so; newer models without one say there is none.

## Output parity

Only `tests/parity/goldens/node/i18n/catalogs.json` changes: 96 new English hover messages add the `hover` area and update catalog counts, fallback counts and fingerprints across the 38 locales. Existing message-area fingerprints are unchanged. The full comparison checked 3,080 goldens; every browser render, Simulation, planning, layout and export golden stayed unchanged. After the deliberate catalog update, the focused i18n comparison reports zero changes.
