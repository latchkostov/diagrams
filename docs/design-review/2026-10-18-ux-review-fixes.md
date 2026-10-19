## PR 178 review fixes

The source review checked the simulations panel's focus handoff and latency disclosure against the UX principles. The panel captures its opener above the lazy-loading boundary and takes heading focus only after capture. Escape preserves the existing nested-picker behavior and returns to the live bar when a menu opener has disappeared.

Latency disclosure stays contextual without adding chrome. Only overflowing summaries intercept the pointer, so ordinary tooltips keep nearby nodes reachable. Scrollable summaries remain open across the pointer gap, use React Flow wheel/pan isolation, and show a keyboard focus outline. Tab enters a node's details and Shift+Tab returns to a focusable node; presentation details preserve ordinary backward traversal when nodes are not focusable. Browser regressions exercise scrolling in short embedded and presentation viewports.

The designer review identified canvas scroll interception; the final change adds `nowheel` and `nopan`. A broader always-interactive hover was rejected after browser tests exposed blocked node clicks. A new topology-aware loss classifier was unnecessary: the existing dropped metric already supplies the requested loss policy, while Checks tracks unread retained traffic separately.
