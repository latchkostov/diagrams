## P-05: bundle trim analysis, lane A (2026-10-24)

Analysis of `4254600f84a77a7be94601c008d73e42be93687e`, the branch's starting master.
No application, test, budget, generated artifact or golden changes are proposed in this commit.
All sizes below are bytes, with gzip level 9 and the existing compression settings. Node 24.22.0,
pnpm 12.11.2, frozen lockfile, Vite 8.3.4; ordinary production build, without `VITE_E2E`.

**Recommendation:** one example-discovery PR, candidate A, with a measured acceptance target of
10,000 B less startup and canvasFirstView JavaScript. Its projection is large enough to restore
both requested reserves. Candidates B and D remove duplicated/dead payload and are worthwhile
separate PRs, but cannot meet the reserve targets by themselves. These are estimates for future
implementations, not savings delivered by this documentation commit.

## Current budgets and exact measurement commands

PowerShell, from this worktree after `pnpm install --frozen-lockfile`:

```powershell
$env:E2E_GATE = '1'
Remove-Item Env:VITE_E2E -ErrorAction SilentlyContinue
pnpm build
pnpm size
$env:BENCH_BASELINE_ONLY = '1'
$env:BENCH_OUT = 'tests/.output/p05-bench'
node scripts/bench/bundle.mjs
```

`E2E_GATE=1` enables the public-only examples build guard; it does not enable test hooks.
`BENCH_BASELINE_ONLY=1` avoids making a second comparison archive; this is an absolute measurement.
The benchmark's JSON is `tests/.output/p05-bench/parts/build-bundle.json`.
`pnpm size` calls `scripts/bundle-budget.mjs`, builds the platform viewer and checks Forge resources.
The bundle benchmark supplies the aggregate startup, canvas and Live budgets that the size script
does not print. The script's human-readable kB values are rounded; the table uses exact gzip lengths.

| Budgeted entry/resource                        |  Gzip B | Fixed limit B | Headroom B | Status                        |
| ---------------------------------------------- | ------: | ------------: | ---------: | ----------------------------- |
| Main entry                                     | 107,967 |       123,500 |     15,533 | In budget                     |
| startup                                        | 170,821 |       177,000 |      6,179 | Below 8,192 B warning floor   |
| canvasFirstView                                | 374,787 |       383,000 |      8,213 | Only 21 B above warning floor |
| liveSession, additional to canvas              | 130,134 |       135,000 |      4,866 | Below warning floor           |
| Platform viewer, JS/CSS/fonts                  | 629,403 |       805,000 |    175,597 | In budget                     |
| Forge resources, both resources and all assets | 914,456 |     1,020,000 |    105,544 | In budget                     |

Forge also passes its separate raw-byte limit: 2,656,356 / 5,000,000 B, leaving 2,343,644 B.
The viewer sum follows `manifest.files` and the size script's extension filter, counting each asset
once. Forge follows `checkBudget` in `integrations/confluence-forge/check.mjs`.

For exact viewer/entry values behind the rounded size output:

```powershell
@'
import fs from 'node:fs';
import zlib from 'node:zlib';
const gz = p => zlib.gzipSync(fs.readFileSync(p), {level: 9}).length;
const html = fs.readFileSync('dist/index.html', 'utf8');
const entry = /<script\b[^>]*type="module"[^>]*\bsrc="([^"]+)"/.exec(html)[1];
const manifest = JSON.parse(fs.readFileSync('dist-viewer/manifest.json', 'utf8'));
console.log('entry', gz('dist/' + entry));
console.log('viewer', manifest.files.filter(n => /\.(js|css|woff2)$/.test(n))
  .reduce((sum, n) => sum + gz('dist-viewer/' + n), 0));
'@ | node --input-type=module
```

Startup is the static closure of index.html's module entry and modulepreloads: **18 chunks**.
Canvas first view adds **CanvasView 106,218 B** and **canvas-shared 97,748 B**.
The Live number is its additional static closure, excluding the canvas closure; it is not the
whole cost of visiting Live. Platform viewer and Forge are independent builds, not app startup.

## Module attribution method and limits

The rankings use Rolldown's **rendered module code and import graph**, not source-file sizes.
For each nonempty `OutputChunk.modules[id].code`, measure its isolated gzip. Allocate that chunk's
actual minified gzip proportionally to those module gzip weights:

`attributed(module) = gzip(chunk.code) * gzip(module.code) / sum(gzip(rendered module.code))`.

The attributed column is rounded to the nearest byte. The isolated column is the gzip of the
rendered module before final chunk minification. Contributions sum to each measured chunk before
rounding. Gzip dictionaries, shared names and final minification make per-module wire bytes
non-additive: this is an explicit attribution convention, not a claim that deleting a module saves
exactly its allocation. Candidate projections below are separately labelled.
Source-map-only attribution was rejected because generated example metadata has no original
source mappings; it can incorrectly assign the registry to the preceding thumbnail helper.

Import chains below are actual static graph paths, shortened as follows. `M` is `src/main.tsx`;
`A` is `src/App.tsx`; `C` is `src/canvas/CanvasView.tsx`; paths otherwise start at `src/`, except
package names under `node_modules`. `A ⇢ C` crosses `canvas/loadCanvasView.tsx`'s dynamic import.
A module with several importers shows one reason it is included, not every route retaining it.

### Top 15 startup modules

| Module                                         | Chunk          | Attributed gzip B | Isolated gzip B | Import chain                                                                           | Needed before first interaction?                                                                                                  |
| ---------------------------------------------- | -------------- | ----------------: | --------------: | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `react-dom/cjs/react-dom-client.production.js` | index          |            61,102 |          99,254 | M → react-dom/client.js → module                                                       | Yes: React root, events and rendering.                                                                                            |
| `examples/metadata.ts` (generated)             | examples       |            12,599 |          14,620 | M → A → examples/index.ts → module                                                     | Titles yes; all thumbnails, long descriptions and feature tags no. Start-card decoration can load separately.                     |
| `stencils/catalog.ts`                          | native         |             8,437 |          11,477 | M → lib/diagramIO.ts → lib/thumbnail.ts → module                                       | Role/identity/accent data yes; every English description is not needed by the initial editor. Also retained by model role lookup. |
| `interop/native.ts`                            | native         |             6,120 |           8,325 | M → lib/diagramIO.ts → module                                                          | Validation yes, before any saved/file/link document is installed. Some export routines only on use.                               |
| `interop/useInterop.tsx`                       | index          |             5,072 |           8,239 | M → A → module                                                                         | Core open/save/session wiring yes; closed-dialog orchestration only on use.                                                       |
| `lib/diagramIO.ts`                             | index          |             4,238 |           6,884 | M → module                                                                             | Initial document/library/privacy/session state yes.                                                                               |
| `App.tsx`                                      | index          |             3,950 |           6,416 | M → A                                                                                  | Yes: application shell and navigation.                                                                                            |
| `model/requestRouting.ts`                      | requestRouting |             3,445 |           4,621 | M → lib/diagramIO.ts → interop/native.ts → model/routingValidation.ts → module         | Grammar/bounds yes for arbitrary initial documents; playback matching is already separate.                                        |
| `model/autoscalingSchema.ts`                   | native         |             3,063 |           4,166 | M → lib/diagramIO.ts → interop/native.ts → model/resourceValidation.ts → module        | Validation yes when the initial document contains resource settings.                                                              |
| `react/cjs/react.production.js`                | react          |             3,033 |           4,366 | M → react/index.js → module                                                            | Yes: component/hook runtime.                                                                                                      |
| `examples/index.ts`                            | examples       |             2,477 |           2,874 | M → A → module                                                                         | Slugs/titles/picker order yes; importer table and discovery details need not all be consumed immediately.                         |
| `components/TopBar.tsx`                        | index          |             1,666 |           2,707 | M → A → module                                                                         | Yes: navigation and primary controls.                                                                                             |
| `interop/ui/menus.tsx`                         | index          |             1,663 |           2,701 | M → A → components/TopBar.tsx → module                                                 | Triggers/status yes; closed submenu contents no.                                                                                  |
| `components/Icon.tsx`                          | index          |             1,626 |           2,642 | M → A → module                                                                         | Visible shell glyphs yes; uncommon glyphs already have a lazy extension.                                                          |
| `scheduler/cjs/scheduler.production.js`        | index          |             1,506 |           2,446 | M → react-dom/client.js → react-dom-client.production.js → scheduler/index.js → module | Yes: React scheduling.                                                                                                            |

### Top 15 canvasFirstView modules

This aggregate includes startup; repeated rows are the same bytes, not a second download.

| Module                                         | Chunk          | Attributed gzip B | Isolated gzip B | Import chain                                                                   | Needed before first interaction?                                                                                  |
| ---------------------------------------------- | -------------- | ----------------: | --------------: | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `react-dom/cjs/react-dom-client.production.js` | index          |            61,102 |          99,254 | M → react-dom/client.js → module                                               | Yes.                                                                                                              |
| `@xyflow/react/dist/esm/index.js`              | canvas-shared  |            19,694 |          32,027 | M → A ⇢ C → module                                                             | Core canvas rendering/events yes; not every optional control. Do not delay the event adapter.                     |
| `@xyflow/system/dist/esm/index.js`             | canvas-shared  |            14,128 |          22,975 | M → A ⇢ C → @xyflow/react → module                                             | Yes: pan/zoom, geometry and interaction support.                                                                  |
| `examples/metadata.ts`                         | examples       |            12,599 |          14,620 | M → A → examples/index.ts → module                                             | Titles yes; rich discovery metadata no on a populated canvas.                                                     |
| `editor/useEditor.ts`                          | CanvasView     |             8,703 |          14,915 | M → A ⇢ C → module                                                             | Selection/history/document commands yes; clipboard/arrangement paths only when invoked.                           |
| `stencils/catalog.ts`                          | native         |             8,437 |          11,477 | M → lib/diagramIO.ts → lib/thumbnail.ts → module                               | Canvas identity/artwork/defaults yes; full description text no.                                                   |
| `interop/native.ts`                            | native         |             6,120 |           8,325 | M → lib/diagramIO.ts → module                                                  | Initial validation yes.                                                                                           |
| `canvas/CanvasView.tsx`                        | CanvasView     |             5,940 |          10,179 | M → A ⇢ C                                                                      | Yes: stable camera, pointer and focus host.                                                                       |
| `i18n/stencils.ts`                             | canvas-shared  |             5,089 |           8,276 | M → A ⇢ C → canvas/Palette.tsx → module                                        | Labels/subtitles yes for the visible rail; all description closures no. English fallbacks duplicate catalog text. |
| `interop/useInterop.tsx`                       | index          |             5,072 |           8,239 | M → A → module                                                                 | Core open/save/session wiring yes.                                                                                |
| `lib/diagramIO.ts`                             | index          |             4,238 |           6,884 | M → module                                                                     | Yes.                                                                                                              |
| `App.tsx`                                      | index          |             3,950 |           6,416 | M → A                                                                          | Yes.                                                                                                              |
| `editor/builtinActions.ts`                     | CanvasView     |             3,856 |           6,609 | M → A ⇢ C → module                                                             | Shortcut/action registration yes before the first key; every optional menu builder no.                            |
| `lib/stencilSearch.ts`                         | canvas-shared  |             3,575 |           5,814 | M → A ⇢ C → canvas/Palette.tsx → lib/stencilDisplaySearch.ts → module          | No before a search query; the initial rail can render unfiltered. ContextMenu is another eager retaining path.    |
| `model/requestRouting.ts`                      | requestRouting |             3,445 |           4,621 | M → lib/diagramIO.ts → interop/native.ts → model/routingValidation.ts → module | Initial validation yes.                                                                                           |

## Four concrete candidates

The savings table uses **conservative implementation targets**, not completed-build deltas.
Each implementation must remeasure the actual closures, including new shell/import overhead and
chunk regrouping. A zero means no savings credited in that entry, not permission to regress it.
Independent platform builds must be remeasured too; this app graph cannot establish their deltas.

| Candidate                                  | Main entry B | startup B | canvasFirstView B | liveSession extra B | Platform viewer / Forge B credited | Risk        |
| ------------------------------------------ | -----------: | --------: | ----------------: | ------------------: | ---------------------------------: | ----------- |
| A. Rich example discovery metadata         |            0 |    10,000 |            10,000 |                   0 |                              0 / 0 | Medium      |
| B. Deduplicate English stencil fallbacks   |            0 |         0 |             2,000 |                   0 |                              0 / 0 | Medium      |
| C. Stencil search data and ranking         |            0 |         0 |             4,300 |                   0 |                              0 / 0 | Medium–high |
| D. Remove dead production tutorial message |           32 |        32 |                32 |                   0 |                              0 / 0 | Low         |

### A — Example discovery, one new lazy surface

**Evidence and bytes.** The generated metadata accounts for 12,599 B. An isolated data projection
retaining only slug/title/first-simulation identity changes minified object-form gzip from
13,569 to 1,268 B: 12,301 B difference. Applying that retained fraction to the module's allocation
projects **11,421 B** removable from both startup and canvas. Budget **10,000 B** after the eager
shell/registry adapter. This projection compares full and compact data in the same representation;
it is not an implementation build. Moving thumbnails alone projects only an 8,385 B isolated
difference, before adapters: too little margin to recommend the thumbnail-only version.

**Boundary.** Have `scripts/example-metadata.ts` emit a compact startup identity registry and a
separate rich registry. Move thumbnails, long descriptions and `shows` into that rich module.
Introduce `examples.discovery` through `defineLazySurface`, registered in `lazySurfaces.ts`,
loading an `ExampleDetails` component plus that registry. Reuse it for start-card decoration and
the examples browser's discovery body. Update eager `examples/index.ts` and App's start options so
they never statically read the rich registry. Keep authored short summaries, slugs, title order,
first simulation identity, loading a selected diagram, and clickable start rows in the eager shell.
The existing examples dialog frame remains cancellable outside the chunk. No eager preload link;
intent prefetch may improve warmth but must not substitute for the held-chunk contract.

**While held.** Keep row dimensions and their pointer cursor, so late thumbnails cannot move a
click or make the camera refit. The picker, blank diagram, Open and recent diagrams work. Focus
stays on the clicked row/search/trigger; a late load cannot reopen a dismissed card or steal focus
after another diagram opens. Arrow/Enter/Esc behavior remains in the shell. Use `export: "skip"`:
example discovery is editor chrome and must never hold model downloads, images or recording.
Live must start even if this chunk never resolves. Declare focus restoration to the browser's
trigger/search field, rather than moving focus into a decorative thumbnail.

**Required held-chunk cases.** Hold before navigation, on both a blank start card and a populated
diagram. Verify row hit boxes/cursor, Tab/Shift+Tab and arrow/Enter activation; keep a query typed
before release. Dismiss/switch diagrams while held, then release and assert no focus, selection or
camera change. Open a recent/file/example from the eager controls. Fail the request and exercise
one shared Retry, plus Close/Esc and reopening. While held, save a diagram file, export SVG/PNG
and Interactive HTML, and go Live/record; downloads must complete without the discovery chunk
and exclude start-card chrome. Cover a remembered locale and RTL. Extend `lazy-surfaces.spec.ts`,
`lazy-loading.spec.ts` and the start-card/examples/export integration families.

**Risk: medium.** It touches App/registry contracts and first-visit decoration, but leaves the
canvas event owner, document loader, node geometry, name fields and export readiness untouched.

### B — Remove duplicated English stencil text, no new lazy boundary

**Evidence and bytes.** Catalog English defaults and compiled `i18n/stencils.ts` repeat text.
A projection finds **271** plain name/description fallbacks whose English literal also occurs in
the rendered catalog. Replacing those fallbacks with catalog-field references changes isolated
minified module gzip from **8,159 to 3,843 B**. Applying that ratio to its 5,089 B allocation gives
**2,692 B** projected canvas savings; target **2,000 B** after mapping/compiler overhead. Literal
matches are an opportunity count, not proof that every same-text field has the same meaning.
Preserve exceptions when the corresponding field differs; never deduplicate by text alone.

**Change.** Keep synchronous names, subtitles and translation lookup available. Generate typed
stencil/field-to-message mappings so the compiled fallback can reference that field in the
already-loaded catalog instead of embedding its English again. Preserve each original numeric
or English translation key, vendor-parent description rules and missing-translation fallback.
Do not change `en.ts`'s authored messages or expand the initial locale catalog.
No module moves and no additional `defineLazySurface` are needed: deletion of duplicate payload
is preferable to a split here. Existing inspector/tooltip surfaces retain their focus/export policies.

**While held.** This candidate adds no loading state. Existing `inspector.identity`,
`inspector.node-settings` and `canvas.node-tips` chunks may still be held: node/rail cursors and
labels remain correct; pending rename keys never reach canvas shortcuts. Export uses the same
labels in edit/presentation/Live, with no new wait. No mode transition or Live dependency changes.

**Required cases.** Exhaustively compare old/new label, description and subtitle results for
every public stencil in English, one translated catalog and missing-key fallback; include vendor
parents and client-framework exceptions. Verify translation-key identity, not just English output.
Hold identity/settings/tips independently, quick-add then type a label immediately, check field
order/cursor and Esc restoration, then Retry. Export while tips are held and switch to Live.
Require i18n validation, regeneration and unchanged parity, including search and viewer outputs.

**Risk: medium.** No async interaction risk is added; wrong field/key reuse could silently change
translations, search ranking or vendor defaults. Reject the projection's substitutions individually
when their semantic correspondence cannot be proved.

### C — Stencil search, one shared optional search surface

**Evidence and bytes.** In canvas-shared, `stencilSearch.ts` contributes 3,575 B,
`stencilDisplaySearch.ts` 318 B, `stencilSearchCore.ts` 311 B and `vendorAliases.ts` 772 B:
**4,976 B** total. Target **4,300 B** after an eager query/focus shell. Do not count the entire
ContextMenu (2,931 B) or the stencil translation module as savings: both have initial-view users.

**Boundary.** Move the four search modules behind a new `canvas.stencil-search` component
surface using `defineLazySurface`, shared by the rail's filtered-results adapter and searchable
stencil menus. Reuse it from the already-lazy palette/gallery where appropriate. Remove **both**
eager search imports: Palette → stencilDisplaySearch and ContextMenu → stencilDisplaySearch.
Leaving either route intact saves essentially nothing. Keep the rail's unfiltered items and its
input, generic ContextMenu positioning/keyboard/cursor code, type-ahead capture, connection
anchor/landing outline and action registration eager. Register `export: "skip"`; specify the
owning search input as the focus field. This is a search boundary, not a menu/interaction rewrite.

**While held.** Text is captured in the same input, not discarded or sent to one-key shortcuts.
Pending results must not allow Enter to select an obsolete unfiltered row. Keep Esc dismissal,
arrow navigation policy, cursor styling and connected-menu positioning in the eager shell.
Completion cannot create a node after cancellation, steal rename focus, move the camera or
execute a queued Enter twice. Export and Live are independent of search; switching to Live
cancels editor-only placement intent. Search failures expose Retry without losing the query.

**Required held-chunk cases.** Hold before rail typing, Ctrl+K stencil search, double-click
quick-add, dropped-connection quick-add, node "+" and Alt+arrow. Type immediately, including T/L/C,
then test Enter/Esc and cancellation before release; assert no annotation or mode toggle leaks.
Verify pointer/grab/text cursors and connected placement at compact/wide widths and RTL after
Inspector reveal. Release then pick once: one node/connection, label focused, expected Tab order
and one undo transaction. Fail/Retry and reopen with a preserved query. Save/export and start
Live with search still held. Keep generic context menus usable during the hold.

**Risk: medium–high.** Several discovery hosts share the index, and quick-add owns sensitive
placement/naming transitions. Do not lazy-load the interaction controller or shell to win extra bytes.

### D — Remove a dead tutorial fallback call

**Evidence and bytes.** App imports `tutorials/metadata.ts` even though the production tutorial
surface folds away. Rolldown retains a standalone `msg` tagged call for “A mobile app talks to an
API”. Removing just that **32 raw-byte** expression from a diagnostic copy of the emitted entry
reduces its gzip by **32 B**. No source was changed for this measurement. Its module attribution
is 82 B; that larger allocation is deliberately not claimed as deletion savings.

**Change.** Gate metadata construction with the same literal DEV/E2E condition as App's tutorial
entry, so the production branch never calls `msg`. Keep preview metadata available in development
and E2E. No new split or `defineLazySurface` is needed; the existing `tutorial.app` and
`tutorial.list` surfaces remain the tutorial download boundaries. Avoid a broad purity annotation
on all message calls just to eliminate this one.

**While held.** Production behavior is identical: no tutorial UI exists. In preview builds, holding
either tutorial surface must retain its pending frame, trigger cursor, Esc/Close and return focus;
preview keys must not edit the underlying diagram. Existing `export: "skip"` policies remain.
Ordinary file/image export and Live must still work when no tutorial is active.

**Required cases.** Production bundle assertion that this metadata module/call is absent;
DEV/E2E assertion that the tutorial title/start affordance remains. Hold/fail/Retry each existing
tutorial surface and cancel before release, verifying focus and no stale navigation. Retain export
and Live tests around entering/leaving preview. No new pending UI is introduced by this deletion.

**Risk: low.** This is the smallest deletion and should be a separate tutorial-surface cleanup.
It is too small to solve P-05's reserves.

## Recommendation, acceptance and rejected approaches

Interpret 16 KB conservatively as **16,384 B**. The required reductions from this snapshot are
**8,171 B canvasFirstView** and **2,013 B startup**. The minimum set by number of surfaces is
**A alone**. Its 10,000 B acceptance target projects:

| Entry           | Current gzip B | Projected gzip B | Projected headroom B | Required headroom B |
| --------------- | -------------: | ---------------: | -------------------: | ------------------: |
| startup         |        170,821 |          160,821 |               16,179 |               8,192 |
| canvasFirstView |        374,787 |          364,787 |               18,213 |              16,384 |

Merge A only when the actual production measurement confirms **startup ≤ 168,808 B** and
**canvasFirstView ≤ 366,616 B**, with unchanged limits. The more conservative 10,000 B target
leaves margin for wrapper and bundler effects; it is not a guaranteed lower bound from analysis.
If the implementation misses, remeasure the graph before adding another surface. B+C+D's
conservative targets total only 6,332 B of canvas savings, so the small alternatives together
do not replace A at this snapshot. D can land independently first because it deletes dead code;
B is preferred over another asynchronous split if further reserve is wanted. Neither is required
to expand A's PR scope. C should wait unless measured reserves still warrant its interaction risk.

Each future PR has one surface owner and its own measurement, regression tests, release fragment
and UX review. Confirm the held-chunk regression fails with the split's shell protection removed.
Use production `VITE_E2E=1` tests, `data-testid` selectors and explicit allowed ports; no sleeps or
absolute timing assertions. For A/C, repeat affected specs and annotations, drawing-basics,
round4-polish, viewport, platform and inspector neighbours in Linux under load (`--repeat 5`,
declared workers/CPUs). Require every repeat to pass. Preserve the two canvas chunks, startup
module exclusion contracts and every parity golden; no goldens should change for these trims.

The current Live reserve is also below the floor. These four candidates credit it no savings;
a dedicated Live graph analysis/PR remains necessary and is outside the two requested targets.
Likewise, startup/canvas savings are not a claim to shrink the platform viewer or skill ZIP.

Rejected for this batch:

- Raising limits or increasing Zopfli effort: neither reduces the modules delivered to a new user.
- Deferring React Flow, camera, pointer ownership, focus handling or action registration: their
  presence is required for the first input; placeholders cannot safely reproduce these contracts.
- Moving native validation wholesale: arbitrary saved/imported/link documents must be checked
  before installation. A file-loader redesign is a larger trust/lifecycle change than this trim.
- Counting a moved file as a saving while a second eager importer retains it, or counting
  unminified/isolated module gzip as guaranteed wire savings. New lazy/shared chunks can also
  increase the Live-extra metric: reject that regression rather than hiding it in aggregate totals.
- Trimming descriptions or examples from the product: preserve content and public file defaults;
  the proposals change payload ownership or remove duplicate representations.

## Reproducing the graph ranking

Run after the measurement commands above. This standalone diagnostic captures rendered module
code before final minification and static graph edges, then reports the same attribution convention.
It writes only an ignored diagnostic file. Nested viewer/worker builds use their own configurations;
the returned main build is the graph ranked here.

```powershell
@'
import {build} from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
process.env.NODE_ENV = 'production';
process.env.E2E_GATE = '1';
delete process.env.VITE_E2E;
const gz = s => zlib.gzipSync(s, {level: 9}).length;
const graph = {};
const result = await build({
  configFile: path.resolve('vite.config.ts'), logLevel: 'silent',
  plugins: [{name: 'bundle-analysis', buildEnd() {
    for (const id of this.getModuleIds()) {
      const m = this.getModuleInfo(id);
      graph[id] = {imports: m.importedIds, dynamic: m.dynamicallyImportedIds};
    }
  }}], build: {write: false}
});
const out = (Array.isArray(result) ? result : [result]).flatMap(r => r.output);
const chunks = out.filter(c => c.type === 'chunk');
const byFile = new Map(chunks.map(c => [c.fileName, c]));
const html = String(out.find(c => c.fileName === 'index.html').source);
const entry = /<script\b[^>]*type="module"[^>]*\bsrc="([^"]+)"/.exec(html)[1];
const preloads = [...html.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)]
  .map(m => m[1]);
function closure(files) {
  const seen = new Set(), stack = files.map(f => byFile.get(f.replace(/^\.\//, '')));
  while (stack.length) {
    const c = stack.pop();
    if (!c || seen.has(c)) continue;
    seen.add(c); stack.push(...c.imports.map(f => byFile.get(f)));
  }
  return seen;
}
const startup = closure([entry, ...preloads]);
const canvas = closure([...startup].map(c => c.fileName)
  .concat(chunks.filter(c => c.name === 'CanvasView').map(c => c.fileName)));
const rows = [];
for (const c of chunks) {
  const modules = Object.entries(c.modules).filter(([, m]) => m.renderedLength > 0 && m.code);
  const weight = modules.reduce((sum, [, m]) => sum + gz(m.code), 0);
  for (const [id, m] of modules) rows.push({
    id, chunk: c.name, isolated: gz(m.code),
    attributed: gz(c.code) * gz(m.code) / weight,
    startup: startup.has(c), canvas: canvas.has(c)
  });
}
fs.mkdirSync('tests/.output', {recursive: true});
fs.writeFileSync('tests/.output/p05-ranking.json', JSON.stringify({graph, rows}, null, 2));
for (const scope of ['startup', 'canvas']) console.table(rows.filter(m => m[scope])
  .sort((a, b) => b.attributed - a.attributed).slice(0, 15)
  .map(({id, chunk, isolated, attributed}) => ({id, chunk, isolated, bytes: Math.round(attributed)})));
'@ | node --input-type=module
```
