## Static viewer bundle for app platforms

`pnpm build:viewer-bundle` creates a deterministic static viewer in `dist-viewer/` with hashed
JavaScript, CSS and font files. It supports view and play through the same canvas as the web
component, with no inline script, workers, persistent storage or outbound branding link.
Loading never autoplays. A documented host adapter exposes `load`, `play`, `stop` and loaded,
error and auto-height events. The existing bundle size gate now budgets the viewer's assets too.
See [the host contract](../VIEWER-BUNDLE.md). Platform manifests and attachment bridges follow later.

Deferred Confluence diagrams can now initialize from keyboard focus. Regression coverage also
checks that off-screen attachments are not fetched until activation, and diagrams without saved
simulations still play when clicked.

Output parity: 2,530 goldens checked, none changed, added, missing or stale. The new platform
bundle is a separate artifact; existing diagram exports retain their behavior.
