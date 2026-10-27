## Image export performance: PNG raster blocker resolved (2026-10-27)

Resolved by the owner's 2026-10-27 decision to allow a capped PNG raster tolerance. The sliced PNG
implementation and current validation are recorded in [the release fragment](../release-notes/2026-10-27-sliced-png-export.md).
SVG stays byte-identical. The evidence below records the original, stopped investigation.

The original investigation stopped under the task's instruction to report rather than change image output.
No production change, golden update, commit, push or PR was made. The reusable SVG/PNG CPU-profile
scenarios remain as an uncommitted benchmark change. The rejected implementation and diagnostic
probe are retained locally in `tests/.output/export-prototype.patch` and
`tests/.output/export-raster-probe.ts`.

### Measurements

Production E2E build, Chromium 156.0.8078.4, Windows, one benchmark worker, CPU throttle 2,
`features pipeline@100` and `features pipeline@500`, quick mode, one sample per size.
These local runs are diagnostic, not a controlled same-job Actions comparison. Browser calibration
changed from 20.4 ms in the baseline to 26.7 ms in the first prototype run; workload contention
limits the precision of comparisons. No committed benchmark baseline was changed.

| Metric            | Nodes |     Before | Rejected final prototype |
| ----------------- | ----: | ---------: | -----------------------: |
| SVG export        |   100 |   2,071 ms |                 1,868 ms |
| SVG export        |   500 |   9,548 ms |                12,830 ms |
| PNG export        |   100 |   3,235 ms |                 2,701 ms |
| PNG export        |   500 |  14,440 ms |                15,790 ms |
| PNG longest frame |   100 |   866.6 ms |                 166.3 ms |
| PNG longest frame |   500 | 3,641.6 ms |               1,056.6 ms |

The prototype misses the approximately 200 ms frame target at 500 nodes and does not demonstrate
an export-time improvement there. Raw reports remain under `tests/.output/export-before/`,
`export-after/` and `export-final/`.

### Profiles and existing behavior

Named-build profiles at 500 nodes identify computed-style copying and serialization as hot spots:

| Main-thread self time |        PNG |        SVG |
| --------------------- | ---------: | ---------: |
| `setProperty`         | 4,040.5 ms | 4,087.7 ms |
| `getPropertyValue`    | 3,589.6 ms | 3,876.3 ms |
| `serializeInContext`  | 1,901.3 ms | 1,888.8 ms |
| `drawImage`           |    92.7 ms |        n/a |
| `toDataURL`           |   359.1 ms |        n/a |

Profiles are local `.cpuprofile` artifacts in `tests/.output/export-before/profiles/`.
The application already caches embedded font CSS across exports in `image.ts`.

### Rejected approaches and evidence

- Patching a cached default style preserves values but changes Chromium's declaration ordering
  and shorthand serialization. A basic browser probe produces different SVG bytes.
- Caching complete style serialization and native shallow templates, sharing default styles with
  per-element differences inside the PNG decoder's SVG, splitting SVG-container serialization,
  and asynchronous PNG encoding preserve the tested output after removing strip drawing. They
  still miss the 500-node frame target; the local export-time results do not justify shipping them.
- Drawing a single decoded image in destination-clipped 128-pixel strips changes actual pixels,
  not just PNG compression. An isolated comparison on the public export fixture found **459
  differing pixels**, with a **maximum channel difference of 192**. The first differences are at
  rows 255 and 256, across a strip boundary. The same source image, canvas dimensions and draw
  transform are used for both paths. Existing byte-comparison tests fail on three fixtures with
  strip drawing and pass after removing it.
- Creating an ImageBitmap from the foreign-object SVG and drawing it to OffscreenCanvas fails
  during `convertToBlob()` with `SecurityError: A tainted OffscreenCanvas may not be exported.`
  A small independent browser probe and the public-fixture diagnostic both reproduce this.

These observations rule out the attempted clipping and OffscreenCanvas paths under the required
byte identity. They do not prove that every possible rendering strategy is impossible. Further
work needs a rendering approach that preserves the full-image rasterizer's pixels while bounding
its browser-controlled work; changing goldens or accepting the current prototype would not meet
this task.

### Validation performed

- Focused image units: 7 passed.
- Final focused style-cache, document-check and byte-comparison E2E tests: 7 passed, including
  SVG and PNG at 300 nodes and three public examples.
- Negative controls: reverting the implementation causes the new SVG serialization unit and
  both new browser regressions to fail. Restored implementation passes them.
- Pixel/OffscreenCanvas diagnostic: 1 passed, reproducing both blockers above.
- Typecheck passed before the last shallow-template refinement.
- Earlier exploratory failures: three PNG byte comparisons with strip drawing; one test was
  interrupted by an edit-triggered Vite reload and passed in the subsequent seven-test run.
- Full parity, full units, reserve/size checks and the final gate were not run: the task stopped
  before a shippable implementation. There is no gate SUMMARY, pushed SHA or PR number.

Production files and existing tests were restored to HEAD. All committed goldens remain untouched.
