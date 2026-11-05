## Lazy export shell convention

Visual exports identify pending and failed lazy shells by `data-lazy-shell`, a
shared DOM convention that requires no imports from optional surface modules.
Default shells and custom Live node/edge readout shells carry the marker. SVG,
PNG and interactive HTML retain their existing bytes; no parity goldens change.

The Linux offline-build investigation found a filename collision, not bundled
collaboration code: the planning chunk `ui-BciROoM5.js` matched the test's room
pattern in its generated hash. Its module graph contains planning UI and charts,
and the existing collaboration-module exclusion passes.
The exclusion rules remain unchanged; future failures now report the matching
filenames and modules instead of an opaque bundler object. The content-hash
matching issue is recorded as a follow-up.
