## Sliced PNG export (2026-10-27)

PNG export now draws in 128-pixel destination-clipped strips, yielding between strips and before
asynchronous PNG encoding. Repeated computed declarations are shared only in the PNG decoder's SVG;
the downloadable SVG keeps its existing path and bytes. Cancel, document-version checks, the Retry
error on peer edits, and scoped Undo/Redo remain intact. Progress advances through rasterization and
stays unfinished during encoding. No control or UI text was added.

### PNG comparison contract and goldens

Owner-approved PNG tolerance: a pixel counts as different when any RGBA channel differs by more
than **16/255**. At most **min(floor(width × height × 0.001), 600)** such pixels are allowed, with exact
dimensions. E2E uses full resolution; browser parity keeps its existing 4× downscaled PNG references
and applies the same cap to those comparison pixels. The prior diagnostic saw 459 differing pixels
of 1,920,000 (all channel deltas), with a maximum channel difference of 192 at strip seams. The current
full-size comparisons count 46, 96, 0 and 66 pixels above 16/255 across three public examples and the
300-node fixture (maximum observed channel delta 223). The 600-pixel ceiling leaves small seam
headroom while preventing a large image's percentage allowance from growing without bound.
Moved-card and missing-label mutations fail at both comparison resolutions. Boundary tests exercise
the 16/17 channel threshold, the percentage limit, the 600/601 cap and mismatched dimensions.

**No goldens were changed or re-recorded.** SVG still compares exactly; HTML text/payload and its
existing viewer screenshot comparison keep their prior contracts. The new allowance is used only
for image-export PNG raster comparisons.

### Measurements

Production E2E builds, Chromium 156.0.8078.4, Windows, one worker, CPU throttle 2, quick mode,
one sample per size. Before is the retained investigation's `export-before/results.json`; after is
`export-sliced/results.json`, both under ignored `tests/.output/`. Browser calibration was 20.4 ms
before and 19.8 ms after. These local runs are diagnostic, not a controlled same-job Actions comparison.
No committed benchmark baseline changed.

| Metric                   | Nodes |     Before |     After |
| ------------------------ | ----: | ---------: | --------: |
| `features/exportPng`     |   100 |   3,235 ms |  3,054 ms |
| `features/exportPng`     |   500 |  14,440 ms | 12,827 ms |
| `exportPng-longestFrame` |   100 |   866.6 ms |  186.7 ms |
| `exportPng-longestFrame` |   500 | 3,641.6 ms |  787.6 ms |
| `features/exportSvg`     |   100 |   2,071 ms |  2,170 ms |
| `features/exportSvg`     |   500 |   9,548 ms |  9,813 ms |

PNG's longest frame falls 78% at 500 nodes; a roughly 788 ms browser task is still perceptible.
SVG uses unchanged code; the observed timing variation does not establish a speed improvement.

### Rejected approaches and regression checks

Dropped the SVG style-copy cache and SVG serialization prototype: the previous combined prototype
made the 500-node SVG export slower (12,830 ms versus 9,548 ms), despite preserving tested bytes.
OffscreenCanvas remains unsuitable because encoding the foreignObject image taints it. No budgets
or reserve thresholds were raised.

Temporarily restoring the old renderer makes both new raster regressions fail: it draws no clipped
strips and encodes before checking a document change after drawing. The restored implementation
passes both. The collaboration regression covers edits during cloning and between raster strips,
including Retry, no download, and scoped Undo/Redo. The initial focused comparison run passed all
eight tests; the restored boundary/collaboration run passed all four tests.

### Verification availability

The requested Linux two-repeat gate for interop/export, image-slices, collab-export and html-export
was attempted with three workers/CPUs and `--max-wait 1`. It exited **75** before running tests:
`gate: busy: push and let CI run the full gate, or retry later`. Another live gate held the entire
shared budget; no lock was removed and no heavy check was run around it. There is no gate SUMMARY.
Per the busy-gate rule, the branch is pushed for PR CI. Full parity, units, production build/size,
and the reserve heavy test remain unverified locally; all goldens remain untouched.
