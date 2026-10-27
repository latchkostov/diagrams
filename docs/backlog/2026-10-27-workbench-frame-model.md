## Share effective frame geometry and index label collisions

PR #359 round one leaves two P2 findings for a broader change:

- R-0a5f0d9d25: expose effective frame points/path to the stroke, halo, hit area and route controls together, and restore all consumers for capture. Updating only more SVG paths would leave route handles and editing semantics inconsistent; this needs a shared frame-route model.
- R-a59f2aaef5: build shared spatial indexes once per settled frame update, then query nearby labels and route segments while excluding the current edge by ID. Replace the per-label collection copies and add a large-selection operation-count regression. This is not a safe one-line adjustment.

Hand-shaped routes are protected from the lane pass in the current fix. The two browser-assertion P2s, R-2238824322 and R-df3881fa3f, are resolved in that fix.
