## Linux Nightly caching regressions

Saved cache simulations now load their runtime before the cross-engine digest harness starts playback. Synchronous headless planning, simulation evidence and trace entry points own that dependency too; the Lab loader, local-peer tutorial runner and engine diagnosis benchmark also prepare it independently of opening Live.

Opening a large diagram in Focus keeps its first card visible. The fit now reserves the card's top decoration as well as its body. Previously the first Black Friday card could sit 32 pixels below the pane top while its decoration extended outside Focus's 28-pixel clipping frame, hiding the card and replacing it with a pin.

Image export reads SVG paint once and applies it to the detached clone. It no longer writes and restores paint throughout the live canvas, invalidating styles/layout and waking observers during a sliced capture. The low-zoom failure was cumulative startup/export work reaching the existing whole-test deadline, rather than an indefinite readiness wait.

SVG bytes, declaration/attribute order, simulation results and export goldens remain unchanged. No timeout, tolerance, retry, skip or bundle budget is increased. The generated skill viewer is refreshed for the camera correction.

## Golden change

Only `browser/render/black-friday-commerce.json` changes, in two fields: the opening Focus viewport moves from `translate(285.972px, -671.784px) scale(1.00541)` to `translate(298.425px, -637.081px) scale(0.972973)`, and the Web card's formerly empty rendered text becomes `Shoppers on the web Storefront SPA`. Reserving the decoration space slightly reduces the fitted zoom and moves the frame so that card stays visible. These are the intended camera correction; no SVG, PNG, engine or other golden is updated.

## Entry-point audit

- Live: the existing lazy CacheSession loads the runtime before constructing the controller.
- Engine digests: await ensureCacheRuntime in both the browser and the Node VM reference.
- Headless planning and agent descriptions: Node/SSR module loading prepares the synchronous headless dependency; fresh-realm tests exercise a run, scenario sizing and agent description. Browser AI prefetch leaves the cache runtime lazy, pinned by a production bundle test.
- Checks: the existing worker and main-thread checks/request-check fallbacks already load it. The browser's no-worker planning fallback now explicitly awaits it too. Simulation evidence imports it independently, covering both the evidence worker and its main-thread fallback.
- Agents/WebMCP: descriptions/checks use the prepared planning/evidence paths. Authoring already supplies analytical cache demand when choosing a scale, so it does not require playback; authored simulations run through Live's existing cache boundary.
- Skill viewer, Interactive HTML, host embeds and Confluence: playback goes through ViewerCanvas and Live's cache boundary. Fresh cache playback is covered in the skill file, current HTML template and the bundle under Confluence Forge's CSP.
- Tutorials: ordinary playback delegates to Live; isolated local-peer practice now awaits both diagrams' runtime before constructing either controller.
- Lab/headless traces: the Lab engine loader awaits the runtime; the synchronous trace entry point imports it independently.
- Benchmarks: simulation benchmarks already imported the runtime; engine diagnosis now does too. Browser benchmarks drive the same Live boundary as the app.

## Rejected approaches

Complete native-style templates and deferred custom-declaration serialization preserved the tested bytes but did not establish a consistent speedup or eliminate loaded deadlines. Neither implementation is retained. The retained export change removes writes to the live drawing and leaves native clone serialization in place.

## Verification

The full unit run passed 15,193 tests (10 existing skips). After refining the loading boundary, 108 affected unit tests and all 35 bundle reserve tests passed. The engine digest suite passed all 288 checks across Chromium, Firefox and WebKit, matching V8.

Full parity compared 3,342 goldens and found only the intentional render change above. After updating it, 84 render/layout goldens and 1,119 affected Node goldens checked clean. Five Linux repetitions with six workers on four CPUs passed all 1,115 camera and Inspector neighbour cases without failures, flakes or skips. The final focused Build checks passed twice (12 tests); the isolated Dev Follow-camera cases also passed twice (six tests), as did the final held-runtime Dev check (two tests). The PR records the earlier candidate failures and final scoped checks separately.
