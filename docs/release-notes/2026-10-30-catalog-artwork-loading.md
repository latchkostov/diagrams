## Catalog artwork loads as it enters view

The stencil library and stencil menu rows now fetch artwork when it enters the visible scroll area. A shared observer releases hidden or removed rows and ignores callbacks from a disconnected observer. Current diagram artwork keeps its eager loading behavior.

A Windows regression observes 118 distinct SVG requests for a broad library search before this fix. Native lazy-loading hints still fetch 84; explicit viewport observation meets the unchanged input-sized bound of 20 and loads the final row when scrolled into view. This reduces optional artwork traffic during metadata loading. It does not establish that every native Nightly failure is fixed. No output golden is intentionally changed.
