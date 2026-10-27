## Smaller canvas and Live downloads

Consolidated modules that already load together and stopped constructing a full trace journey just to highlight its path. Canvas first view drops from 378,295 to 373,879 gzip bytes, leaving 9,121 B headroom. Live's additional download drops from 134,981 to 131,549 B, leaving 3,451 B headroom (the accepted 3,000 B minimum; further deferral to reach 8 KB would broaden loading and recovery risk).

No new lazy surfaces or controls, no engine source changes, and no budget or skill ZIP cap increases. All output parity goldens must remain unchanged; none is intentionally updated. The full per-chunk comparison and rejected alternatives are in [the design review](../design-review/2026-10-27-live-canvas-trim.md).
