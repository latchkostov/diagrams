## Hover summary scroll bar

Hover summaries showed a scroll bar on almost every node and connection at 1280×800, 1440×900 and 1920×1080 (retry-storm, webhook-ingestion). The frame is a fixed 320×332 px with a 1 px border, leaving 330 px. Header 54, verdict 48, vitals 62, attention 64, three 28 px section rows (84) and the 22 px footer total 334 px, so `overflow: auto` scrolled by 4 px and the footer hint was cut off. Nothing overflowed horizontally.

Section rows are now 25 px plus their 1 px rule (26 px rows, above the 24 px target minimum), so the summary totals 328 px in the unchanged frame. An unpinned card has `overflow: hidden` and its sections area shrinks and clips whole rows if a short viewport caps the frame, so a summary never scrolls. Pinned cards keep internal scrolling for a truly short viewport; at 1280×800 a pinned card with any section open fits without scrolling (up to 592 px with Threads & calls open).

Before and after (1280×800, retry-storm's Checkout and its call to Payments): `2026-10-23-hover-scrollbar/before-node-card.png`, `after-node-card.png`, `before-edge-card.png`, `after-edge-card.png`.
