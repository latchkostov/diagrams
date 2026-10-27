## Smaller skill download and reachable library recovery

The HTML viewer leaves out unreachable stencil-library and context-menu code, saving 14545 B in the skill ZIP on the final synced sources (835330 B to 820785 B). The stencil loading shell saves 990 B, annotation tiles and search initialization save 1621 B, and the context menu with its stencil-search dependencies saves 11934 B. The 835000 B cap stays fixed.

On phones, the pinned library no longer blocks the failed-download Retry notification. Annotation search loads with the library, keeping the canvas under its unchanged third-trim reserve. Import tests explicitly choose Overview before inspecting the entire imported drawing, matching the existing large-diagram Focus behavior.

No parity golden changes. No budgets, reserve thresholds or plugin version changes.
