## Deferred canvas downloads

Boundary rename now focuses and selects Label after its inspector finishes downloading, for both double-click and F2. All deferred inspector panels notify the focus controller when their fields mount.

PNG and SVG export wait for the diagram's shape outlines, attachment geometry, React commits and queued handle measurements before capturing. Failed geometry downloads report an export error; geometry arriving during capture invalidates the picture. Shape handles are memoized per node so moving large selections does not thrash the shared geometry cache.

Regression coverage holds inspector and geometry downloads, checks both image formats and download failures, and verifies existing edge endpoints and new connection previews follow the loaded outline. No parity goldens are intentionally changed.
