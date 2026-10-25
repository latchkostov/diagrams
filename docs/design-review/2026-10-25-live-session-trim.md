## Live session trim analysis — 2026-10-25

Lane A: analysis only. Measured commit `489125be16616b3294fbb9ceaa4d5096c4e95370`
on `chore/live-session-trim-1`, Windows, Node 24.22.0, pnpm 12.11.2, Vite 8.3.4.
Final `pnpm sync` brought in the tutorial/English-key update at this revision. The measurement build identity was `dede4fb115fd340c207d487b021a96bb788c0b14`; pin it below to reproduce content-hash/compression effects after the documentation commit changes HEAD. No product, test, budget or golden changes.

**Recommend one trace/slow-motion runtime surface (candidate A).** Its gross opportunity
is 5,600 B gzip; allowing 800 B for the retained facade, registration and loading UI gives
an estimated 4,800 B net trim and **8,887 B headroom**. This is a forecast, not an implemented
or verified saving. The implementation must measure at least 4,105 B net before shipping.
Do not accept the slow-motion-only split: its 4,295 B gross opportunity leaves just 190 B
for its adapter before falling below the floor.

## Current delivery entries and exact measurement

Run from this checkout in PowerShell, with the normal deployment defaults and no E2E flag:

```powershell
pnpm install --frozen-lockfile
$env:VERCEL_GIT_COMMIT_SHA = 'dede4fb115fd340c207d487b021a96bb788c0b14'
$env:BENCH_BASELINE_ONLY = '1'
$env:BENCH_OUT = 'tests/.output/live-trim/baseline'
node scripts/bench/bundle.mjs --mode quick
pnpm build
pnpm size
```

The first measurement writes `tests/.output/live-trim/baseline/parts/build-bundle.json`.
`BENCH_BASELINE_ONLY=1` avoids an unnecessary merge-base build; this measures HEAD, not
a historical benchmark. Gzip is Node `gzipSync(bytes, { level: 9 })`, summed per emitted
file, matching both budget scripts. Vite's printed gzip sizes use a different compression
setting and are not the numbers below. Entries overlap; do not sum the first four rows.

| Entry / delivery set                                                       |  Gzip B | Fixed budget B | Headroom B | Floor status               |
| -------------------------------------------------------------------------- | ------: | -------------: | ---------: | -------------------------- |
| Main entry                                                                 | 108,098 |        123,500 |     15,402 | Above 8,192                |
| Startup: entry + static/preloaded closure, 18 files                        | 159,374 |        177,000 |     17,626 | Above 8,192                |
| Canvas first view: startup + canvas closure                                | 364,390 |        383,000 |     18,610 | Above 8,192                |
| Live additional: LiveSession static closure minus canvas closure, 19 files | 130,913 |        135,000 |  **4,087** | **4,105 B short of floor** |
| Standalone viewer: JS/CSS/fonts                                            | 629,441 |        805,000 |    175,559 | Above 8,192                |
| Forge resources (separate delivery)                                        | 914,492 |      1,020,000 |    105,508 | Above 8,192                |

All JS combined is 3,100,982 B gzip across 269 files; it has no fixed aggregate budget.
Forge also passes its raw budget: 2,656,403 / 5,000,000 B. Viewer and Forge are supplementary
delivery budgets from `pnpm size`, not part of the four browser benchmark entries.

Live additional is currently 130,913 B, rather than inferring it from the brief's approximate
headroom. Its targets are **126,808 B maximum** for 8,192 B headroom and **122,712 B maximum**
for 12 KiB (12,288 B) headroom: net savings of 4,105 B and 8,201 B respectively.

The physical `LiveSession` file is **53,199 B gzip**, not 130,913 B. Its other static files
are `simulation` 42,876; `breaker` 10,087; `defaults` 5,441; `useLiveFixes` 5,141;
`capacityModel` 3,871; `topology` 3,352; `icons` 1,173; `storm` 1,025; `healthWindow` 838;
two distinct `format` files 740 and 592; `readoutDiagram` 648; `addConsumer` 450;
`replayControls` 446; `capacityInputs` 346; `deadLetter` 336; `brokerVocabulary` 206; `list` 146.
Moving code into another statically imported file in this set saves **zero** entry bytes.

## Attribution method and limits

The diagnostic build uses the same Vite config with `write: false` and `sourcemap: "hidden"`.
The physical LiveSession gzip is identical to the normal build: 53,199 B. A diagnostic plugin
records `getModuleInfo(id).importedIds` at `buildEnd` to find real static import paths.
It makes no source transformations. All diagnostic files stay under ignored `tests/.output/`.

For each source-map segment, assign the minified text from its generated position to the next
segment on that line to that segment's source. Keep unmapped scaffolding. For module M,
its **marginal gzip contribution** is `gzip(original chunk) - gzip(chunk with M's mapped spans removed)`.
Rank by this number, not source length or the bundler's unminified `renderedLength`.
For candidate groups, remove their union of spans and recompress once. Do not add individual
module contributions: gzip dictionaries cross module boundaries. Removed text is a diagnostic
compression probe, not runnable JavaScript or a tree-shaking experiment. It establishes a
gross opportunity; actual savings also depend on retained helpers, imports, preload maps,
facades, new chunk boundaries and bundler renaming. No post-trim build was made in this lane.

“First frame” below means an ordinary, untraced Free play entry, including supported fallback
rendering. A saved simulation, remembered capacity overlay or immediate trace can need additional
code immediately; these paths must retain their intent while downloading.

## Top 15 modules in the physical LiveSession chunk

All paths below are relative to `src/`. `L` means `live/LiveSession.tsx`;
`F` means `L → live/session/useFrameLoop.ts`; `T` means `L → live/session/useTraceSpotlight.ts`;
`S` means `T → live/slowmo/useSlowMotion.ts → live/slowmo/controller.ts`.
An import chain is one shortest static path, not the only importer. For example,
`controller.ts` also enters through `session/useLiveSessionState.ts`.

| Rank | Module                              | Marginal gzip B | Import chain from LiveSession           | Needed for first Live frame?                                                       |
| ---: | ----------------------------------- | --------------: | --------------------------------------- | ---------------------------------------------------------------------------------- |
|    1 | `live/controller.ts`                |           7,300 | L → `live/ControlBar.tsx` → module      | Yes: engine ownership, state, controls                                             |
|    2 | `live/particleRenderer.ts`          |           4,626 | F → module                              | Partly: tokens/hit testing; full painter needed for main fallback, not worker path |
|    3 | `live/NodeBadges.tsx`               |           3,303 | L → module                              | Yes: initial rates/status/readouts; hover preparation can be separated             |
|    4 | `live/liveRenderer.ts`              |           3,291 | F → module                              | Yes: scene/worker setup; main implementation conditional                           |
|    5 | `live/LiveSession.tsx`              |           2,778 | L                                       | Yes: session composition, providers and layers                                     |
|    6 | `live/liveActions.ts`               |           2,142 | L → module                              | Guard yes; action builders only on menu/palette intent                             |
|    7 | `live/slowmo/session.ts`            |           1,817 | S → module                              | No: capture/replay state machine driver                                            |
|    8 | `live/slowmo/controller.ts`         |           1,649 | S                                       | No: replay camera, keyboard and lifecycle wiring                                   |
|    9 | `live/ControlBar.tsx`               |           1,519 | L → module                              | Yes: play/restart/speed/simulation controls                                        |
|   10 | `live/liveScene.ts`                 |           1,440 | F → `live/liveRenderer.ts` → module     | Yes: paths, boxes and viewport for either renderer                                 |
|   11 | `trace/journey.ts`                  |           1,368 | T → module                              | No: traced-path construction and replay formatting                                 |
|   12 | `live/traceLabels.ts`               |           1,177 | F → `live/particleRenderer.ts` → module | Conditional: traced labels on main renderer; not ordinary worker first frame       |
|   13 | `live/session/useTraceSpotlight.ts` |           1,163 | T                                       | Partly: narration/path refs needed; journey/replay branches conditional            |
|   14 | `live/session/useCapacityInputs.ts` |           1,142 | L → module                              | Partly: remembered overlay/panel intent; edit/apply callbacks conditional          |
|   15 | `live/session/useFrameLoop.ts`      |           1,110 | F                                       | Yes: engine advance, scene and particle frame loop                                 |

## Top 15 across the budgeted Live additional closure

This second ranking prevents confusing a trim of the physical file with the entry budget.
`C` means `L → live/ControlBar.tsx → live/controller.ts`; `E` means `C → sim/engine.ts`.

| Rank | Module                         | File containing it | Marginal gzip B | Static import chain                                         | Needed for first Live frame?                                 |
| ---: | ------------------------------ | ------------------ | --------------: | ----------------------------------------------------------- | ------------------------------------------------------------ |
|    1 | `sim/engine.ts`                | simulation         |          24,104 | E                                                           | Yes                                                          |
|    2 | `live/controller.ts`           | LiveSession        |           7,300 | C                                                           | Yes                                                          |
|    3 | `live/particleRenderer.ts`     | LiveSession        |           4,626 | F → module                                                  | Conditional fallback, plus small shared helpers              |
|    4 | `live/capacityModel.ts`        | capacityModel      |           3,614 | L → `live/session/useCapacityInputs.ts` → module            | Partly: Free play/scale/inputs are core, not just panel code |
|    5 | `sim/autoscaling.ts`           | simulation         |           3,503 | E → module                                                  | Yes on autoscaled diagrams; no generic first-frame deferral  |
|    6 | `sim/cloudScalers.ts`          | simulation         |           3,333 | E → module                                                  | Yes on cloud-scaler diagrams                                 |
|    7 | `live/NodeBadges.tsx`          | LiveSession        |           3,303 | L → module                                                  | Yes                                                          |
|    8 | `live/liveRenderer.ts`         | LiveSession        |           3,291 | F → module                                                  | Yes, implementation conditional                              |
|    9 | `live/LiveSession.tsx`         | LiveSession        |           2,778 | L                                                           | Yes                                                          |
|   10 | `sim/simulation.ts`            | simulation         |           2,615 | C → module                                                  | Yes for a saved simulation's initial setup/actions           |
|   11 | `sim/admission.ts`             | breaker            |           2,530 | E → module                                                  | Yes for admission-enabled diagrams                           |
|   12 | `live/liveActions.ts`          | LiveSession        |           2,142 | L → module                                                  | Small guard yes; menu/palette builders no                    |
|   13 | `sim/executionReservations.ts` | simulation         |           1,949 | E → module                                                  | Yes for resource/thread execution                            |
|   14 | `live/slowmo/session.ts`       | LiveSession        |           1,817 | S → module                                                  | No                                                           |
|   15 | `stencils/profileFamilies.ts`  | defaults           |           1,779 | L → `live/NodeBadges.tsx` → `stencils/profiles.ts` → module | Yes for resolved stencil defaults/semantics                  |

## Concrete candidates

These are proposed implementation boundaries, not permission to change behavior. No proven dead
code or removable same-context duplication was found that can meet the target. Budget zero savings
for that preferred category rather than calling conditional functionality dead. The worker and main
renderer reuse source but execute in separate environments; sharing an eagerly imported painter chunk
would not trim Live additional. The candidates below therefore use `defineLazySurface`, with metadata
in `src/lib/lazySurfaces.ts`, recovery outside the held chunk, and explicit output policy.

| Candidate                       | Gross gzip opportunity B | Net planning allowance / saving B            | Split                                                            | Risk        |
| ------------------------------- | -----------------------: | -------------------------------------------- | ---------------------------------------------------------------- | ----------- |
| A. Trace/slow-motion runtime    |                    5,600 | Allow 800 overhead; estimate **4,800 saved** | Lazy runtime component + retained command/subscription facade    | Medium–high |
| B. Recording state ownership    |                    1,102 | Allow 300 overhead; estimate **802 saved**   | Lazy recording surface owns reducer with Recorder                | Medium      |
| C. Live action builders         |                    2,050 | Allow 500 overhead; estimate **1,550 saved** | Lazy action-provider surface on menu/palette intent              | High        |
| D. Main-thread painter fallback |                    4,611 | Allow 800 overhead; estimate **3,811 saved** | Lazy renderer adapter surface, conditional on capability/failure | High        |

Allowances are engineering estimates, not measured adapter sizes. They include retained code/new
references in the initial closure; downloaded lazy code is shifted, not deleted. Require an unchanged
startup/canvas budget and no new eager dependency from a retained facade before counting any saving.

### A. Put trace journey construction and the remaining replay runtime behind intent

Move `slowmo/{useSlowMotion,controller,session,machine}.ts` (4,295 B gross as a group) and
the `trace/journey.ts` dependency (1,368 B individually) out of the session's static closure.
Their union is **5,600 B**, not 5,663 B. Move both journey consumers in `useTraceSpotlight.ts`
and `slowmo/controller.ts`; leaving either static import loses the journey saving. Retain
ordinary narration, downstream highlighting, frame refs and a stable inert slow-motion API.
`TraceCard`/slow replay can share the downloaded runtime. Use a registered runtime adapter
component rather than calling a hook after an asynchronous import.

Declare the surface active on trace/replay intent and `export: "await"` because its spotlight
and replay state affect visible output. Keep cancellation, Retry and the pending command in the
shell. A requested replay must synchronously preserve the intended live checkpoint/playing state
before it waits; a no-op `slowRef` must never drop a menu or palette command. Ordinary Live keeps
running before any replay request. Define pending-replay semantics explicitly in the implementation.

While held: hover cards, initial badges/readouts and the normal timeline must continue to work.
A pending trace must keep its requested root/node and show an existing loading affordance, not
dim a wrong path. Replay keys must not fall through to Live or editing actions. A simulation change,
Escape, leaving Live or opening a higher-priority modal must cancel/queue consistently; late resolve
must never reacquire camera ownership. Recording must wait for requested replay and use its exact
start; visual exports wait for active output state, while JSON/Mermaid/data exports stay available.
The already-lazy replay script/painter and `SlowTimeline` are not additional savings.

Required held-chunk cases: ordinary Free play remains interactive; hover and keyboard-pin a node
and edge; normal timeline seek; trace next/slowest/dead-letter; replay from node, trace card and
palette before download; Escape and simulation switch before release; failed load → one Retry;
pending modal ownership; replay checkpoint and camera restoration; image export and record start
held until ready; model export while held; exit/re-entry and stale completion. Exercise worker and
`renderer=main`, reduced motion, recorded slow replay, and paused/live starts. Extend
`lazy-surfaces.spec.ts`, `lazy-retry-trim.spec.ts`, `slowmo.spec.ts`, `trace.spec.ts`,
`lazy-recording.spec.ts`, `live-record-capture.spec.ts` and camera neighbours. Risk is medium–high
because the runtime owns engine holds, camera and key precedence, despite its smaller UI boundary.

### B. Move the recording reducer into the recording surface

`session/useLiveCommands.ts` imports `record/recordModel.ts` eagerly although the Recorder UI
already imports dynamically. Let a registered Recorder surface own `recordReducer` and its full
state; retain only open/cancel intent and a small synchronous capturing/phase bridge in the shell.
`recordModel.ts` accounts for **1,102 B gross**. Do not count the Recorder/capture/WebM code again:
it is already outside Live additional. The shell must keep its lifecycle rules until the chunk arrives.

Use `export: "skip"` for the setup/review UI: it does not belong in diagram images. Separately,
record-start must await active output surfaces before framing/capture. While held, hover/readouts,
timeline and slow motion keep their current state; no presentation framing or countdown starts yet.
Cancel must restore focus without closing another dialog. Preserve the browser's capture user gesture:
download completion must not call the screen picker automatically; the loaded setup's Start remains
the user action. JSON and image exports must not wait for inactive recorder controls.

Required held-chunk cases: open via menu and palette, keyboard Close/Escape while held, no capture
permission request before Start, failure/Retry, leave Live before resolve, exact presentation framing
and cleanup, ordinary and slow-motion recording, and visual/model export with setup held. Extend
`record.spec.ts`, `lazy-recording.spec.ts`, `live-record-capture.spec.ts` and the generated surface
contract. Medium risk: moving state across the boundary can lose pending intent or leave capturing stuck.

### C. Load action construction with the menu/palette surface

Keep `liveMutationGuard` and its shared hint synchronous. Move the `liveActions()` builder
(source lines 61 onward; **2,050 B gross**) into a registered action-provider component loaded on
context-menu or palette intent. Keep a shell Simulation section/loading state and subscribe to
current controller data; preload on intent rather than removing registry entries until after a click.
Export policy is `skip`. It is not safe to leave only the right-click path loading: Ctrl+K searches
the same registry, and slow-motion mutation guards must work before and after resolution.

While held: hover cards/readouts and both timelines work. Menu focus stays with its opener, browser
context menus stay suppressed, unavailable actions cannot reach the canvas, and neither slow motion
nor recording can start twice. A slow-motion/recording transition during the hold must be reflected
when actions arrive. Images, recording readiness and model exports skip this non-output provider.

Required held-chunk cases: node/edge/canvas right-click; keyboard context menu; Ctrl+K search and
activation before resolve; section order and focus; close/reopen; failure/Retry; locale change;
slow-motion guard updates; properties/injection/record actions executed once against current state;
image/data export while held; unregister on exit. Extend `lazy-surfaces.spec.ts`, `live.spec.ts`,
`platform.spec.ts`, `slowmo.spec.ts` and palette/context-menu specs. High risk: missing discoverable
actions and stale enablement are worse than the modest byte saving. Not needed for the minimum trim.

### D. Load the main-thread painter only when selected

Move the `MainThreadRenderer` implementation (lines 261–351 in `liveRenderer.ts`) and the large
painter portion of `particleRenderer.ts` (lines 238 onward) behind a registered renderer adapter
component. Their union gives **4,611 B gross**, not the entire 4,626 B particle module plus the
entire renderer. Keep tokens, geometry helpers, hit testing, scene, capability selection and the
worker path synchronous; audit `MarchRenderer`'s `context2d` dependency. Only fetch the painter
for `renderer=main`, unsupported workers, or worker startup/crash fallback. `export: "await"`
while that output renderer is selected. This is conditional loading, not dead-code elimination.

While held: worker-capable Live must show its first frame without requesting this chunk. Unsupported
browsers need a local, cancellable loading state; controls/readouts/hover cards still work, with no
invisible particles being clickable. Timeline seeks and slow motion must render the latest state on
arrival, not replay stale queued frames. A failed transferred worker requires new canvases before
fallback. Record/image output waits for the chosen renderer; data exports skip it. Recording must
not capture an empty frame or skip awaiting slow-motion paint.

Required held-chunk cases: no request on healthy worker path; forced main path; unsupported worker;
startup failure and crash after transfer; seek/restart/simulation change while held; main-thread
trace labels, hover hit testing and slow captions; retry once; Live exit/dispose while held; image
and recording readiness; no duplicate worker/canvas ownership. Extend `live-render.spec.ts`,
`live-labels.spec.ts`, `lazy-retry-trim.spec.ts`, `slowmo.spec.ts`, `live-record-capture.spec.ts`
and rendering parity. High risk: it introduces a download boundary on the first frame for fallback
browsers. Keep it outside the minimum proposal.

## Recommendation and UX review

Implement **A only** in the next lane, including its journey consumers. Projected Live additional
is **126,113 B** and headroom **8,887 B**, with the explicit 800 B allowance. The entire gross
opportunity allows at most **1,495 B** retained overhead to meet the 8,192 B floor. Reject the
implementation if actual closure savings are below 4,105 B; do not shift cost into startup or canvas.

For the preferred 12 KiB goal, A+B+C has 8,766 B gross combined opportunity and would leave
12,853 B headroom before adapters. It allows only **565 B total overhead**, less than the
1,600 B planning allowance across those surfaces, so **do not promise 12 KiB from it**.
A+D has 10,233 B gross combined opportunity; allowing 1,600 B gives 8,633 B net savings,
Live additional **122,280 B** and **12,720 B headroom**. That is the smallest assessed two-candidate
set plausibly clearing 12 KiB, but D's fallback first-frame risk does not justify it for this warning.
Prefer one boundary and the mandatory floor now; assess D independently if 12 KiB becomes required.

Reject deferring the whole badge layer (first-frame rates/status would disappear), engine/autoscaling
logic (valid diagrams need it immediately), moving code to static shared chunks (zero closure saving),
and moving already-lazy panels/cards/export code (no credit). No new chrome, controls or settings.
Loading feedback must stay local; ordinary Live's first frame, keyboard ownership, narration,
hover/readout values, timeline semantics and meeting/recording appearance remain the UX contract.

Implementation acceptance: retained shell works with each new chunk held and failed; retry/cancel
does not leak camera or engine holds; output policy is exercised with real downloads; targeted
regressions fail when the lazy boundary/readiness fix is removed; affected camera/interaction specs
and neighbours pass Linux load repeats; all parity goldens remain byte-identical. Measure every
entry again with the exact command above. A lazy split alone never permits re-recording goldens.

## Verification for this analysis lane

The production build and `pnpm size` passed. The benchmark reports all four entries under their
fixed limits and only Live additional below the floor. The diagnostic source-map build reproduced
the physical session size; the reproduction script below reproduced both module rankings and every
candidate/group byte probe. The five documentation-fragment tests passed. `pnpm parity` passed:
1,873 Node cases, 110 Linux browser cases; **3,178 goldens, 0 changed, 0 added, 0 missing, 0 stale**.
No runtime implementation or candidate-specific browser tests were run:
the held-chunk cases above are requirements for the implementation lane, not claimed coverage here.
Final repository checks and push-gate results are reported with the commit delivery.

## Reproduce the module attribution

Save this diagnostic as `tests/.output/live-trim/replay.mjs`, then run
`node tests/.output/live-trim/replay.mjs`. It builds in memory and prints both rankings and
the group probes; it does not change source files. The baseline command above creates its directory.

```javascript
import { build } from "vite";
import { gzipSync } from "node:zlib";
process.env.NODE_ENV = "production";
process.env.VERCEL_GIT_COMMIT_SHA = "dede4fb115fd340c207d487b021a96bb788c0b14";
delete process.env.VITE_E2E;
const graph = new Map();
const result = await build({
  logLevel: "silent",
  build: { write: false, sourcemap: "hidden" },
  plugins: [
    {
      name: "trace-imports",
      buildEnd() {
        for (const id of this.getModuleIds()) graph.set(id, this.getModuleInfo(id).importedIds);
      },
    },
  ],
});
const output = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
const chunks = output.filter((c) => c.type === "chunk");
const byFile = new Map(chunks.map((c) => [c.fileName, c]));
const gzip = (s) => gzipSync(s, { level: 9 }).length;
function closure(roots) {
  const seen = new Set();
  for (const stack = [...roots]; stack.length;) {
    const c = stack.pop();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    stack.push(...c.imports.map((f) => byFile.get(f)));
  }
  return seen;
}
const html = String(output.find((o) => o.fileName === "index.html").source);
const urls = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => m[1].replace(/^\.?\//, ""));
const canvas = closure([...urls.map((u) => byFile.get(u)), chunks.find((c) => c.name === "CanvasView")]);
const live = chunks.find((c) => c.name === "LiveSession");
const extra = [...closure([live])].filter((c) => !canvas.has(c));
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function vlq(s) {
  const out = [];
  let n = 0,
    shift = 0;
  for (const char of s) {
    const v = alphabet.indexOf(char);
    n += (v & 31) * 2 ** shift;
    if (v & 32) shift += 5;
    else {
      out.push(n & 1 ? -(n >> 1) : n >> 1);
      n = 0;
      shift = 0;
    }
  }
  return out;
}
function spans(c) {
  const map = c.map,
    lines = c.code.split("\n"),
    ranges = [];
  let offset = 0,
    source = 0,
    originalLine = 0,
    originalColumn = 0;
  for (const [li, mapping] of map.mappings.split(";").entries()) {
    let column = 0;
    const segments = [];
    for (const segment of mapping.split(",").filter(Boolean)) {
      const v = vlq(segment);
      column += v[0];
      if (v.length > 1) {
        source += v[1];
        originalLine += v[2];
        originalColumn += v[3];
      }
      segments.push({
        start: offset + column,
        source: v.length > 1 ? map.sources[source] : null,
        line: originalLine + 1,
      });
    }
    segments.forEach((s, i) => {
      const end = segments[i + 1]?.start ?? offset + (lines[li]?.length ?? 0);
      if (s.source && end > s.start) ranges.push({ ...s, end });
    });
    offset += (lines[li]?.length ?? 0) + 1;
  }
  return ranges;
}
function saving(c, ranges, select) {
  let cursor = 0,
    kept = "";
  for (const r of ranges)
    if (select(r)) {
      kept += c.code.slice(cursor, r.start);
      cursor = r.end;
    }
  return gzip(c.code) - gzip(kept + c.code.slice(cursor));
}
const root = [...graph.keys()].find((id) => id.endsWith("/src/live/LiveSession.tsx"));
const paths = new Map([[root, [root]]]),
  queue = [root];
for (const id of queue)
  for (const next of graph.get(id) ?? []) {
    if (!paths.has(next)) {
      paths.set(next, [...paths.get(id), next]);
      queue.push(next);
    }
  }
const rows = extra
  .flatMap((c) => {
    const ranges = spans(c);
    return [...new Set(ranges.map((r) => r.source))].map((source) => {
      const id = [...graph.keys()].find((key) => key.endsWith(source.replace(/^.*?src\//, "/src/")));
      return {
        chunk: c.name,
        source,
        bytes: saving(c, ranges, (r) => r.source === source),
        chain: paths
          .get(id)
          ?.map((key) => key.slice(key.lastIndexOf("/src/") + 5))
          .join(" → "),
      };
    });
  })
  .sort((a, b) => b.bytes - a.bytes);
console.table(rows.filter((r) => r.chunk === "LiveSession").slice(0, 15));
console.table(rows.slice(0, 15));
const ranges = spans(live);
const slow = (r) => /src\/live\/slowmo\/(controller|session|machine|useSlowMotion)\.ts$/.test(r.source);
const journey = (r) => r.source.endsWith("/trace/journey.ts");
const record = (r) => r.source.endsWith("/record/recordModel.ts");
const actions = (r) => r.source.endsWith("/live/liveActions.ts") && r.line >= 61;
const fallback = (r) =>
  (r.source.endsWith("/live/particleRenderer.ts") && r.line >= 238) ||
  (r.source.endsWith("/live/liveRenderer.ts") && r.line >= 261 && r.line <= 351);
for (const [name, select] of Object.entries({
  slow,
  A: (r) => slow(r) || journey(r),
  B: record,
  C: actions,
  D: fallback,
  ABC: (r) => slow(r) || journey(r) || record(r) || actions(r),
  AD: (r) => slow(r) || journey(r) || fallback(r),
}))
  console.log(name, saving(live, ranges, select));
```
