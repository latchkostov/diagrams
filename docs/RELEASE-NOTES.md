# Release notes

## Responsive image export rebase onto Review follow-ups 3 (#144, 2026-10-16)

- Rebased the export branch onto master's boundary-refit, ancestry and capacity-cache changes,
  preserving both documentation histories and all translation keys. Export behavior is unchanged.
- Took master's skill/plugin files before refreshing the viewer; plugin 1.1.35 is exactly one patch
  above master's 1.1.34. Full parity passes all 2,196 goldens unchanged: zero changed, added, missing
  or stale records. No golden was re-recorded.
- The production bundle regression passes: collaboration, Yjs and tracker code are absent from every
  production chunk, with image export loading only when used. The scoped UX review finds no new
  controls, wording or chrome; export progress and cancellation retain their existing tests.

## Review follow-ups 3, round 1 (2026-10-16)

- Skill layout now copies translated annotation positions from the app's placement result while
  preserving authored metadata. Forced layout and missing-coordinate layout both keep member notes
  inside moved boundaries, and new notes use the translated occupied area.
- Large placement candidates query at most 64 grid cells each, scanning the finite obstacle list
  instead for larger areas. Both paths enforce the obstacle-test budget, and exhausted searches keep
  the deterministic clear-space fallback. AI boundary placement has at most 2,401 candidates, hence
  at most 153,664 cell visits per box regardless of its area, plus the capped obstacle comparisons.
  Counted regressions cover 300,000- and 1,000,000-pixel boxes, exhausted rings and the clear fallback.
- Full layout repairs overlapping sibling boundary padding even when all cards are already clear.
  Tests assert separation of unrelated boundaries while allowing intentional nested containment.
- Temporarily restoring the three original implementation files fails all four new regressions;
  restoring the fixes passes them. Refreshed the released skill viewer, retaining plugin 1.1.34
  (exactly one patch above master). The focused designer source review found no UX issue or new chrome.
- Eight skill-layout goldens intentionally change: for each example below, both
  `node/layout/<example>.json` (only `skillLayout`) and `node/skill/scripts/<example>.json`
  (only `layout`) record the same 80-pixel downward subtree move to clear sibling padding:

  | Example                      | Boundary and members moved                                                                                      |
  | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
  | `aks-app-config-key-vault`   | `aks`, `api`                                                                                                    |
  | `branch-to-datacentre`       | `dc`, `edge-router`, `firewall`, `spine-1`, `spine-2`, `leaf`, `adc`, `web-1`, `web-2`, `orders-db`, `payments` |
  | `contoso-dmz`                | `trusted`, `switch`, `app`, `database`                                                                          |
  | `event-driven-data-platform` | `snowflake`, `raw`, `marts`                                                                                     |

  Every other golden stays unchanged, including browser output. Restoring only the old sibling-repair
  trigger makes all 239 layout/skill goldens match, isolating these intentional changes from the
  output-preserving search optimization and annotation projection.

## Review follow-ups 3 (2026-10-16)

- AI placement rechecks the final boundary fits, so an ancestor growing around a direct member cannot
  swallow an earlier unrelated card. A collision repair settles child boundaries before their parents
  and moves a settled subtree together; this also avoids endless retries between interleaved siblings.
- Metadata-only edits skip placement work. Placement indexes ancestry with linear-size tree intervals,
  and collects only the ancestors needed for a refit. At 1,000 nested boundaries, counted parent reads
  fall from 512,491 to zero for metadata edits and to 12,991 for a deepest-boundary refit. A local probe
  (median of 11 runs after three warmups) measured 72.1 ms to 0.0005 ms and 71.6 ms to 2.89 ms respectively.
  Cyclic input is collapsed into shared ancestry components once, keeping queries constant-time too;
  a 1,000-boundary cycle regression rejects the repeated-parent-walk fallback.
- Capacity analysis normalizes each endpoint once per managed entry, then composes each matched action
  with that cached call. The 500-endpoint, 64-action regression (plus an unaddressed call and a second
  entry) falls from 32,065 normalizations to 502. Cached decisions also retain routed-demand keys:
  a 100-gateway, 64-route chain falls from 329,600 serializations to 6,400, with identical analysis output;
  its local median falls from 266.9 ms to 207.1 ms.
- Phone regressions now preserve an unsaved simulation's title, traffic label and dirty state when AI
  opens from either its rail or Ctrl+I, without saving a simulation. A shared-route regression sends
  50 requests/s through each of a rejected and accepted endpoint: offered demand is 100 and throttled
  demand is 70 under a common 30 requests/s rule, in both incoming-edge orders.
- Temporarily reverting the layout and performance fixes fails their new regressions. Overwriting
  endpoint contributions fails the reversed-edge readout test; removing AI's draft suspension fails
  both phone tests. The collaboration reply-byte fixture is already fixed on master (40fe1225); its
  existing accepted-edit, positive-throttling and encrypted-traffic assertions pass unchanged.
- Refreshed the skill viewer at plugin 1.1.34, one patch above master. No parity golden changes;
  the performance changes preserve outputs. Scoped UX review adds no controls, copy or chrome.
- The first full gate exposed three occupied-port fixture failures: a usable ephemeral port does
  not guarantee its neighbours are outside Windows' reserved ranges. Fixtures now check the complete
  five-port range on IPv4 and IPv6 before keeping their intended occupied member. A forced blocked
  neighbour regression fails with the old setup; the real preflight and its exact-port assertions
  remain intact. All 1,403 E2E tests passed in that run; the complete gate is repeated after this fix.

## Image export review fixes (#142, 2026-10-16)

- PNG and SVG exports capture the editor's document identity and monotonic edit revision. Renaming,
  moving, reconnecting, undoing, replacing or otherwise editing the document between slices stops the
  export and downloads nothing. The existing translated export-failure toast asks to try again.
  Version reads are constant time: they reuse history's committed fingerprint and synchronous editor
  mutation tracking, excluding selection, measurements, live counters and export-owned DOM changes.
- Touch drags wait during export; touch capture is non-passive. Modifier-key releases still reach
  keyboard state, and Cancel remains available by touch, mouse, Enter, Space and Escape.
- Cancellation aborts pending image fetches and file reads, removes image sources and handlers, and
  interrupts canvas/video cloning and decoding. Aborted resources cannot poison the successful-resource
  cache. Progress counts elements consistently, advances through export phases and reaches 100% only
  when the image is ready.
- Regression coverage resumes stalled module/font requests after cancellation, verifies no late
  download or error and then successfully exports again. Module interception matches both dev and
  production URLs. Deliberate reversions prove the revision, input, progress and resource regressions.
- No golden is changed or re-recorded. The localized failure and retry messages are reused to preserve
  the catalog fingerprint too; a new diagnostic translation key and a model-based renderer were rejected
  because they would change pinned output. The refreshed skill viewer keeps plugin 1.1.34, exactly one
  patch above origin/master's 1.1.33.
- The production timing recheck keeps the original frame improvement: at 1,500 nodes, SVG's longest
  frame is 0.77 seconds and PNG's 10.65 seconds (previous branch: 0.56 and 9.39; recorded master:
  32.30 and 28.87). Totals remain comparable at 28.01/43.98 seconds. These are single observations,
  not timing assertions; details and all four comparisons are in [BENCHMARKS.md](BENCHMARKS.md).

## Responsive image export rebase onto Collaboration C0 (#141, 2026-10-16)

- Rebased onto master with Collaboration C0, preserving both documentation histories and all translation
  keys. The production bundle guard still excludes collaboration, Yjs and tracker code from every chunk;
  sliced image export remains lazy and adds no collaboration imports.
- Restored generated skill files from master before refreshing the viewer. Plugin 1.1.34 is exactly one
  patch above master's 1.1.33. Catalog validation reports zero errors and zero stale messages, with the
  existing translation gaps and warnings. No controls, wording or chrome change in this rebase.
- Full output parity checks all 2,196 goldens with zero changed, added, missing or stale records.
  Every golden remains identical to master; none is re-recorded.
- The first full gate passed all 1,411 E2E tests but found a cold-import timeout and a noisy consumer-limit
  timing ratio in unit tests; the same unit command passed on a clean master checkout in this worktree.
  The ID regression now calls the loaded Compose pipeline, retaining every assertion. The consumer-limit
  regression counts runtime route and member reads at an eighth input and the same 24x limit. Restoring
  per-consumer route scans fails at 1,440,001 reads instead of one; removing shared ID allocation still
  fails the Compose regression. Production behavior and timeouts are unchanged.

## Collaboration reply-byte regression coverage (2026-10-16)

- The reply-throttling test now builds its large room through steps checked against the active byte
  limits and asserts every setup edit succeeds. It proves the reply-byte budget runs out before the
  request-count budget, requires positive throttling and bounds actual encrypted reply traffic.
- Audited scaled-limit collaboration setups; the room-measurement test now checks each accepted edit
  and the `room-full` refusal reason. Temporarily bypassing reply-byte throttling fails the corrected
  regression; the production guard is restored. No production behavior, UI or parity golden changes.

## Collaboration C0 rebase onto routing (#140, 2026-10-16)

- Rebased onto #139 and #140, retaining both documentation histories and all translation keys and
  values. Regenerated locale metadata; catalog validation reports zero errors and zero stale messages,
  with the existing translation gaps and warnings.
- Routing metadata, traffic mixes, route tables, admission quotas, caller addresses and saved simulation
  edits already use C0's shared document adapter. New encrypted-session compatibility tests cover those
  fields and the shared planner's nested boundary refits, including per-person Undo and Redo. Deliberately
  dropping planning or boundary edits makes both tests fail. No production behavior changes were needed.
- Generated skill files start from master's release; the viewer still matches a fresh build. Released
  plugin 1.1.33, exactly one patch above master's 1.1.32.
- Full parity regeneration leaves every golden identical to master: no changed, added or missing
  golden. Production bundle tests continue to exclude collaboration, Yjs and tracker code from all chunks.
- The first full gate found a WebMCP test readiness race: a short polling deadline could expire during
  lazy loading and leave playback pending in the next test. The helper now awaits the mock's playback-start
  signal. A held-sizing regression counts polling calls rather than elapsed time and fails with the old helper.
  This changes test synchronization only; the diagram privacy and evidence assertions stay intact.
- Source UX review: no new controls, copy or chrome; the collaboration proof remains in the Lab.

## Routing R1 rejected admission transactions (2026-10-16)

- The capacity planner owns admission transaction results by router, endpoint and matched action.
  Unknown token or bytes costs, undeclared runtime endpoints and unresolved shared concurrency now
  report zero usable gateway capacity without throwing. Rejected calls charge no rule budget, and
  their route readouts remain distinct from successfully normalized sibling endpoints.
- All four validation-passing rejection regressions and the sibling readout regression fail with
  the fix removed. The routing fuzzer now generates all four rejection shapes at API/endpoint scope,
  with matched rules and Defaults: 5,000 routing seeds, 5,000 rejection seeds and 1,000 overlap seeds pass.
- Rebased onto #139, keeping both documentation histories and the union of translation keys. Skill
  generation starts from master's files; the refreshed viewer ships at plugin 1.1.32, one patch above
  master's 1.1.31. Source UX review adds no controls, copy or chrome; existing readouts show the refusal.
- This correction changes no parity golden. The branch's 104 routing additions and six routing
  contract/catalog fingerprints remain as described below; every non-routing golden is unchanged.

## Review follow-ups rebase (#139, 2026-10-16)

- Rebased the existing fixes onto static-page translations (#138), preserving both documentation
  histories and every English and translated message. Regenerated locale metadata; catalog validation
  reports zero errors and zero stale messages, with the existing translation gaps and warnings.
- Generated skill files start from master and are rebuilt from the combined sources. The refreshed
  viewer ships as plugin 1.1.31, exactly one patch above master's 1.1.30.
- Full parity regeneration leaves all 2,092 master goldens identical: no changed, added, missing or
  stale records. This rebase adds no behavior changes and needs no golden exceptions.

## Routing R1 quota review and master rebase (2026-10-16)

- Managed route tables compose node, endpoint and matched-rule requirements per request, using the
  same helper as playback. A shared quota on endpoint A and its rule is charged once even when
  endpoint B has no quota. The review's 50/100 req/s cases report the correct capacity and utilization
  without invented throttling; the 30 req/s limit keeps its real 70 req/s throttle on A.
- Exact regressions cover all five P1 reports, including the common-rule case over both 10 and 20
  seconds. Removing the fix fails every case. Serialization-count regressions cover addressed and
  empty route catalogs; removing interning produces 31,466 and 31,976 serializations respectively.
- The 5,000-seed routing fuzzer and 1,000 shared-overlap seeds pass. The agent-skill viewer is refreshed
  at plugin 1.1.31, exactly one patch above master. The scoped source UX review found no issue.
- The quota correction changes no frozen diagram output. Relative to master, routing adds 104
  goldens for the public showcase and four invented corpus diagrams. Six shared goldens change:
  `node/agent/tools.json` adds routing input contracts; `node/skill/public-schemas.json` records
  routing contracts and legacy guards; `node/skill/files.json` records the generated routing format
  reference; `node/skill/current-stencils.json` includes the showcase in usage rankings;
  `node/skill/validate.txt` validates the four corpus diagrams; `node/i18n/catalogs.json` adds 117
  messages (routing and the gallery tag), changing only the routing/examples areas. Master's static-page
  translations and all existing non-routing diagram goldens are preserved. See [PARITY.md](PARITY.md#request-routing-r1-what-changed-and-why-2026-10-16).

## Collaboration C0 browser proof (2026-10-16)

- The Lab's `collab-c0` preset demonstrates three encrypted Yjs clients, concurrent edits,
  partition recovery, presence and per-person Undo. A separate, explicit public-tracker spike
  explores WebRTC matchmaking; no backend or production collaboration UI is shipped.
- Production-build tests exclude collaboration, Yjs and tracker endpoints from every app chunk.
  Browser tests verify local editing sends no uploads, external requests, sockets or peer traffic;
  session tests refuse Private diagrams and stop sharing when a copy becomes Private.
- Replace the flaky dense-rule timing comparison with counted record reads at an eighth input
  size and the same 24x limit. Deliberate repeated scans fail at 62.09x (schema registry) and
  58.84x (secret identity); restoring the indexed code passes. Importing collaboration into
  production also fails the new bundle test.
- Rebased onto static-page translations (#138), retaining all catalog keys and documentation.
  Regenerated locale stamps and refreshed the skill release at plugin 1.1.31, exactly one patch
  above master; the viewer already matched. No existing parity golden changes.
- C1 still needs decisions on Private-diagram consent wording, permitted public trackers/STUN,
  TURN service/credentials and connectivity fallback. C0 makes no new Private-sharing promise.

## Responsive image export (2026-10-16)

- PNG and SVG export clone the canvas, embed images and serialize in slices, letting the tab paint between
  them. The existing busy toast shows progress and Cancel; Escape cancels too. Input waits until export ends
  so the picture cannot mix edits. Cancelling or failing restores selection, paint and the title header.
- Image decode failures now reach the error toast instead of leaving export waiting. Production regressions
  cover decode/encode failures and successful retry, cancellation during code/font loading, and PNG/SVG export
  without Worker, OffscreenCanvas or both. The decode regression fails with its fix temporarily reverted.
- Cancel stays visible until export cleanup completes: dismiss and unrelated notifications cannot hide it.
  Escape also cancels a stalled initial export-module download, before the renderer loads. Ownership and
  early-Escape regressions fail with their fixes removed; notifications resume after the task finishes.
- The port retains html-to-image 1.11.13's upstream MIT notice in source and the minified export chunk.
  A production-build regression checks the shipped copyright, permission and warranty text; disabling
  legal-comment retention fails it. Existing startup and lazy-loading assertions remain unchanged.
- Rendering remains on the main thread: workers cannot render this HTML picture, and a model renderer would
  change the pinned output. PNG decoding/drawing still contains an unsliced browser task. Timing results and
  the remaining Live-view work for perf PR 4 are recorded in `docs/BENCHMARKS.md`.
  The #138-base same-machine sweep reduced the 1,500-node SVG's longest frame from 32.30 to 0.56 seconds,
  PNG's from 28.87 to 9.39 seconds; total exports went from 40.35 to 29.68 and 48.62 to 42.73 seconds.
  These are single observations at 2× CPU throttle, with calibration drift documented alongside the results.
- Rebased onto static-page translations (#138), review fixes (#139) and Routing R1 (#140), retaining
  both documentation histories and all i18n keys.
  Regenerating static-page metadata leaves it unchanged; i18n has zero errors and zero stale entries.
  The refreshed skill viewer ships at plugin 1.1.33, one patch above base `78269886`'s 1.1.32.
- `pnpm parity:update` checks all 2,196 goldens with zero changes, additions, missing or removed records.
  PNG bytes and canonical SVG text match master; only the library's random pseudo-element class names
  are normalized. No golden is re-recorded to accommodate a failure.

## Static-page translation review fixes (2026-10-16)

- Skill-page translations bind to named blocks and preserved inline slots, so adding paragraphs or
  reordering outputs cannot shift translations. English copy, install commands and controls are unchanged.
- The app excludes the 31 standalone-only messages from its runtime locale chunks; the sign-in and
  skill scripts retain their page subsets and offline behavior.
- Browser regressions check real OAuth channel delivery without an opener, opener delivery when
  BroadcastChannel fails, the exact target origin and query removal before dispatch. All four install
  commands and clipboard values are checked against fixed independent expectations in German, Arabic
  and the pseudo-locale. All four review findings were accepted. Deliberate reversions/mutations
  fail all three app-catalog checks and all six new browser cases.
- The refreshed agent-skill viewer ships at plugin 1.1.30, one patch above master.
- Rebased catalog unions preserve master's autoscaling messages and existing translations. Only
  `tests/parity/goldens/node/i18n/catalogs.json` changes: each of the 37 language catalogs and the
  pseudo-locale gain the `staticAuth` and `staticSkill` hashes for 31 messages. Existing area hashes,
  fallback counts and every other golden stay unchanged relative to master.

## Request routing R1: routes, mixes, route tables and colours (2026-10-16)

- **Optional request routes.** A source can send several request kinds at different rates: its **Traffic mix**
  lists request routes (method and path, with host, headers and query under Advanced) by share or by rate. Nothing
  changes until someone adds one: diagrams without routes play and look exactly as before.
- **Route tables on HTTP routers.** Kong, API Management, API Gateway, NGINX, Envoy and the other HTTP routers get a
  **Route table** in the inspector (or Add routes… on the right-click): ordered rules matching method, path
  (exact, starts with, or a template like /orders/{id}), host, headers and query, each sending to one or more
  connections by weight, then a Default. The first table keeps today's connections in its Default; removing it
  rejects everything else with 404. A matched rule never falls through; a down canary keeps its share. Optional
  per-rule rate limits reject with 429, a shared account quota is charged once.
- **Colours you can tell apart.** In Live each route's requests take its own colour and marker (an
  Okabe–Ito colour-universal palette, four shapes) with an outline that reads on both themes. The inspector's
  **Routes** legend names each route with its counts; traces and slow motion say which rule sent a request where
  ("POST /orders → rule 1 → 10% split") or why it was rejected.
- **Safe edits.** Deleting or reconnecting a connection a table sends to is refused with **Remove from route
  table**, never silently rerouted; copies, agents (`set_meta` requestRoutes, node and connection props) and the
  file format share one validation path. Capacity analysis, explanations and `describe_diagram` follow the same
  routing.
- **Showcase.** "Parcel API behind a route table" (Integration) is an invented parcel platform behind a Kong-style
  gateway: a mobile app and carrier webhooks hit five routes at different rates, a 10% pricing canary, an old app
  version rejected 404, and carrier events saturating their service. It's tagged Routing in the gallery.
- **Unchanged:** every existing diagram's simulation, checks, exports and rendering; their parity outputs are
  unchanged. See [SIMULATION.md](SIMULATION.md#request-routing-r1-planningrequestroutes).

## Boundary refit review, round 2 (#139, 2026-10-16)

- Agent and pasted layouts exclude every ancestor boundary from placement obstacles, both
  before and after fitting. Collision moves refit the member's boundary and its ancestors
  bottom-up, preserving containment and membership.
- Unboxed boundaries fit in one batch in both paste and skill layout. Geometry and hierarchy
  are prepared once; collision adjustments reuse those indexes while keeping the existing
  placement order. An operation-count regression compares 16 and 128 boundaries: restoring
  either old loop produces 64× work and fails the 24× limit.
- A production browser regression clicks Draw these on an unchanged degraded selection,
  restores its KEDA policy, source and reader connection, and checks the original diagram
  remains unchanged. Caption contrast tests count underlying cell and entry visits, including
  duplicate entries, nonmatching overflow scans and aborted queries, on fresh and cached passes.
- All seven review findings are valid: the ancestry P1 and three P2s describe one defect;
  the batching P1 and both test gaps are addressed separately. Temporarily removing each fix
  fails its regression. No findings are rejected. Deferring all collision fits until the end
  was rejected because it changed existing flat-diagram placements; indexed immediate refits
  preserve them. No output golden changes or re-recording are needed.
- UX review: nested members stay inside their boundaries, recovery uses the existing report
  action, and no product controls or wording are added. The Lab supplies the small retry fixture.
  Generated skill layout and the released viewer are refreshed; plugin 1.1.30 remains exactly
  one patch above origin/master. This fixes existing behavior and adds no showcase feature.

## Verification gate review fixes (2026-10-16)

- The full local gate owns its app server: gate mode disables reuse for every
  Playwright server, and an occupied port anywhere in its five-port range fails
  before checks begin with a clear remedy. This prevents testing another checkout.
- Nonignored untracked files block verification both before checks and before the
  HEAD stamp. Gitignored local files remain allowed. Focused Vitest and Playwright
  tests now fail the full gate even outside CI.
- A fresh E2E bundle is built once per gate and reused across six shards. A failed
  build cannot run shards against an older bundle or stamp HEAD. The installed and
  versioned runners stay in sync. No output goldens change; product UI is unchanged.
- Review triage: all seven findings are valid. The two P1s and the security P2
  describe the same server-ownership issue; both focused-test P2s share one fix.
  No finding is rejected. Regression tests cover every underlying issue, including
  occupied ports, ignored/untracked files, focused-test CLI rejection and build reuse.
- The first full gate also caught a flow-building test issuing Alt+arrow while its
  selection's inspector reveal was still moving the viewport. Selection now waits for
  that layout before the next gesture. A clock-controlled regression fails at the
  canvas boundary assertion when those waits are removed; existing placement,
  connection and Undo assertions remain intact. No application geometry changes.

## Reliable local verification (2026-10-15)

- The full push gate now runs every shard after failures and reports complete JSON-based
  totals. Its versioned runner retains each run's traces/reports, includes the entry-size
  check, uses three browsers with zero retries, and never stamps a partial or failed run.
  The Windows `~/bin/verify-push.sh` is updated from the versioned, regression-tested runner.
- Retained run directories use short unique names, with the complete commit SHA in the
  log and verification stamp. This leaves room for offline exports under Windows MAX_PATH:
  a 260-character password-export path was readable by Node but rejected by Chrome.
  A path-budget regression preserves this headroom without shortening the tested filename.
- Full gates serialize across worktrees using an OS-owned repository lock. Three concurrent
  gates saturated the Windows host and stalled page startup/input in otherwise passing tests.
  A barrier-based regression proves the second gate waits and is released after the first
  gate fails. No retries, ignored browser errors, antivirus exclusions or longer UI timeouts
  replace these checks.
- The production-only gate starts its one app server. Four unused servers previously built
  and watched files for every shard, including accumulated trace/export HTML. Normal
  multi-project Playwright runs retain all servers and projects; no Chromium test is removed.
- Startup timing still advances the full pre-play clock delay, but skips paused animation
  frames. A frame-count guard catches the redundant replay that exhausted the local timeout;
  every simulation tick after Play is still delivered. An observed Windows asset-buffer
  failure remains guarded by the console-error assertion; no network error is filtered out.
- Browser regressions wait for the mounted canvas before Save, a replacement example before
  returning to its predecessor, the inspector's reveal before Fit, and real fonts before
  comparing Undo geometry. Text gestures resolve their field for each click; a forced late
  panel shift covers the previously stale coordinates. All existing save, privacy, chip,
  selection and history assertions remain.
- Compiler compatibility probes are split by compiler; the full import cap has its own test.
  Only these intentional integration/stress cases receive CI's 40-second hang backstop.
  The import still maps, lays out and validates 5,000 nodes; no performance guard is relaxed.
- The import column-complexity guard counts internal array reads instead of timing batches
  of fresh maps. It retains the eighth-input comparison and 24x limit, with less fixture work;
  repeated spread/concat copying still fails the guard without depending on garbage collection.
- Windows test browsers disable Chromium's TCP port randomization while retaining every
  pinned Playwright feature flag. A tiny standalone loopback page reproduced a connect failure
  with Windows error 10055 before any HTTP request; normal Chromium had one such failure in
  4,800 navigations, versus none in 4,800 with the feature disabled (both probe orders).
  This workaround changes neither the app nor Windows settings. Its narrow internal API
  integration is covered by config tests and must be reviewed when Playwright is upgraded.
  Navigation and console-error assertions still fail on any network error; there are no retries.
- UX review: no product controls or behavior change. No showcase is needed. No output golden
  changes are intended; no goldens are re-recorded. Global timeout increases, automatic
  retries, smaller cap fixtures and changes to production save/layout behavior were rejected:
  they would hide failures, reduce coverage, or change the app without evidence of a defect.

## Autoscaling A3: cloud adapters and scenario sizing (2026-10-16)

- **Four cloud scalers on the shared A1/A2 lifecycle.** A compute node's Simulation inspector offers one preset
  per platform: ECS target tracking (CPU or ALB requests per target), ECS step scaling, Container Apps HTTP or
  event rule, App Service autoscale rules and Cloud Run. Each keeps the A1/A2 pattern: the preset plus three
  main fields (the platform's target, minimum, maximum); cooldowns, alarm periods, windows, bindings, workload
  resources and the complete policy JSON are under Advanced. Documented defaults are cited; cadence, alarm
  windows and idle retention that vendors don't publish are labelled assumptions. See
  [SIMULATION.md](SIMULATION.md#a3-cloud-scaler-adapters-and-scenario-sizing).
- **Scenario sizing.** Check diagram plays each saved simulation headless with the same engine and seed, and
  suggests a higher maximum, more partitions, a lower target, or (when the simulation's own backlog goal fails)
  a warm minimum, or explains that an admission quota binds. A same-seed rerun verifies every suggestion before
  it's offered as one undoable fix. The research example reproduces: at 3× traffic an HPA at max 10 and 92% CPU
  with a 70% target needs max 14. The same words appear in the Checks card, in agents' `describe_diagram` and
  `check_diagram`, and in Live details while that simulation plays. It runs in the checks worker, never on the
  editing thread, and only while the capacity check is on; over its work or message budget it says unavailable.
- **Showcase.** “Timetable API sleeps overnight” (Cloud) is an invented Cloud Run API that has no instances
  overnight, wakes on demand, hits its maximum in the morning rush with the planner's suggestion, and returns
  to zero. It's tagged Autoscaling in the gallery.
- **Validation everywhere.** Load balancer and event-source bindings go through the shared resource validator at
  every creation and edit path, native reads, imports and agent operations; edits that would break them are
  refused atomically, and connection label edits are kept.
- **Unchanged:** legacy, A1 and A2 diagrams play exactly as before; their parity outputs are unchanged.

## Review follow-ups: fitting and persistence (2026-10-16)

- Opening, fitting, panning and zooming a diagram do not save it or turn an example into
  your own copy. A real edit still saves and promotes the example, including edits retained
  from an earlier session. Fits no longer serialize the document to update persistence.
- UX review: viewing an example leaves it an example; editing keeps the existing copy and
  Undo behavior. No controls added.
- Opening fits share cancellation with measured refinements, and empty canvases do not
  leave a bootstrap fit waiting for their first node. Nested boundary fitting shares one
  pure planner across the editor and agent placement. Position-only fits reuse font readiness;
  Lab readiness stops reading nodes once reported.
- On phones, opening AI switches away from Inputs; reopening Inputs folds AI. Caption contrast
  retries work that previously exhausted its budget, bounds spatial queries including empty
  cells, and skips unrelated annotation text. Malformed raw scaling properties remain editable.
- Import recovery keeps the exact degraded selection, offers a same-boundary retry when it
  can restore KEDA dependencies, distinguishes the drawn and retry counts, and reports omitted
  policies only for retained workloads. Escape, click-away and inspector removal now have
  frozen-clock naming-persistence coverage; the existing immediate save behavior is unchanged.
- Output parity: no goldens changed. Readiness tests render their own comparison baseline,
  removing their dependency on the order in which render tests update goldens. The skill viewer
  is refreshed at plugin 1.1.30, one patch above origin/master.

## Nightly keyboard and test readiness (#129, 2026-10-16)

- Escape reliably leaves Live after closing the simulation panel, including when a host render
  commits during the keypress. The session keeps its keyboard subscription across host renders;
  a Lab regression forces that ordering and fails with the previous callback.
- The export round trip finishes the export notification before importing; the capacity focus
  check fits its target before clicking. Layout audits use one public fixture per test, and the
  saved-simulation naming check opens its public run directly. Storm persistence waits for the
  reloaded live session and allows two full page loads. All existing contract assertions remain.
- UX review: keyboard back-out levels and focus destinations are unchanged; no product controls
  added. The skill viewer is refreshed at plugin 1.1.28, one patch above origin/master.
- Output parity on refreshed master: all 1,863 goldens unchanged; none re-recorded. Investigation and verification:
  [nightly #129](NIGHTLY-129.md).

## Collaboration architecture research (2026-10-15)

- Added [a sourced collaboration recommendation](research/collaboration.md): optional anonymous E2E rooms,
  browser-side Yjs and a TypeScript/Node relay, followed separately by encrypted persistence and optional accounts.
- Compared collaborative tools, sync engines, hosting/auth costs and self-hosting; specified the Private opt-in
  boundary, key rotation, per-user undo, local simulation/presenter design, portable review and phased acceptance tests.
- Research only: no app behaviour, dependencies, privacy gates or output goldens change. Hosting prices and unknowns
  are dated; a prototype and security review remain prerequisites, not completed implementation evidence.

## Stencil names and agent connection defaults (2026-10-15)

- Changing a stencil updates a node's name when it still matches the previous stencil's default.
  Custom names and explicitly supplied names stay intact. Inspector, palette, bulk and agent edits
  share the model rule; Undo restores the stencil, name and inferred relationships together.
- Agent/WebMCP `connect` now uses the editor's existing relationship inference when no relation is
  supplied: Secret, Config, Identity, Telemetry, Deploys and Depends on. Explicit relationships win,
  including explicit `flow`, which stays authored across later stencil changes. Ordinary connections
  keep their flow and request/message defaults. The public operation schema describes the inference.
- Parity: `node/agent/edit/nightly-batch-elt.json` changes two label fields from Salesforce to
  AWS Lambda: the renamed node and its later reference-error candidate. New
  `node/agent/stencil-defaults.json` pins default/custom names, inferred secrets, explicit Config and
  explicit flow. `node/agent/tools.json` adds flow to the relation enum and corrects its description;
  `node/skill/public-schemas.json` updates only the operation schema's byte count and hash.
  All other existing goldens stay unchanged. Details: `docs/PARITY.md`.
- UX review adds no chrome or controls. Refreshed the stale skill viewer; plugin 1.1.27 is exactly
  one patch above origin/master.
- The full gate exposed a page-hide test whose first example edit could already be saved when it
  became an owned copy. The test now starts with an owned document and pauses the clock where it
  stands, preserving both pending-edit and lifecycle-flush assertions. No save behavior changes.

## Static-page languages (2026-10-15)

- Sign-in and `/skill/` now follow the app’s saved language, browser language, and English fallback
  in all 37 translated locales. Direct links and offline copies include their translations.
- English HTML remains byte-identical. Privacy and Terms remain intentionally English-only.
  Commands, paths, download links and OAuth delivery retain their behavior; RTL prose reads in
  its own direction while commands remain LTR. No controls were added.
- Only `tests/parity/goldens/node/i18n/catalogs.json` changes: each language gains `staticAuth` and
  `staticSkill` hashes for 31 new messages; catalog totals rise by 31, and existing area hashes
  and English fallback counts remain unchanged. No diagram, simulation or export golden changes.

## Autoscaling A2 edit preservation (#125, 2026-10-15)

- Finishing a name with Enter, Esc or a click away immediately saves its complete transaction,
  including the new Connection field reached with Tab, Tab. The CI trace showed the typed label
  on the canvas but an earlier autosave without it; the debounce no longer leaves that older save
  after naming finishes. A fake-clock E2E regression fixes that ordering deterministically.
- Editor transactions use the controlled canvas state instead of React Flow's store, which can
  still contain the previous render until its passive effect runs and overwrite newer edits.
- Reconnect and insert retain queued connection labels, relationships and properties. Regression
  tests also cover node labels/subtitles, descriptions, reversal, bulk edits and paste across
  delayed store updates. All six new unit regressions fail with the fixes removed.
- Binding validation stays atomic; it is not bypassed for naming. UX review: existing keyboard,
  inspector and undo flows retain their controls and behavior; no chrome added.
- Rebased onto master’s settled-view fixes after the full E2E run exposed a nested-boundary redo
  failure; both sides of the document conflicts are retained. The naming and edit fixes change no
  output goldens. The stale skill viewer is refreshed; plugin 1.1.26 remains exactly one
  patch above origin/master.
- Full production E2E, all six shards and projects in the pinned Linux image: 1,312 passed,
  1 failed, 0 flaky. The sole failure is the + chip placement predicate at
  `tests/e2e/flow-building.spec.ts:204`, reproduced identically on clean `origin/master`
  (`d2f6f03b`); the naming regression passes. Windows attempts encountered socket-buffer errors.

## Autoscaling A2 import recovery (#125, 2026-10-15)

- Exhausted dependency work is distinct from an oversized boundary. Imports still draw fitting
  boundaries and nodes, retain resolved scaling bindings, and omit unresolved bindings with named
  report entries explaining how to recover by importing a smaller selection.
- Accepted boundaries skip marking already-expanded closures. Regressions cover exhaustion before
  any successful selection, exact work-budget completion, recovery, oversized closure caching and
  eightfold operation-count growth; deliberate reversions fail.
- UX review: recovery stays in the existing import report and boundary selection; no controls added.
  The stale skill viewer is refreshed, with plugin 1.1.26 exactly one patch above master.
- Only `node/i18n/catalogs.json` changes: one English import-recovery message adds one message and
  updates the import-detail hash in every catalog; untranslated catalogs gain one English fallback.
  All diagram, simulation, import, export and browser goldens remain unchanged.

## Autoscaling A2 final import review (#125, 2026-10-15)

- Import selection indexes shared KEDA broker/group routes once and caches their dependency closures
  across boundary candidates, including cycles. Automatic selection stops oversized candidates early
  and caps total expansion work; remaining boundaries stay available in the import report.
- Operation-count regressions cover eightfold shared-route growth, the total work cap, deduplicated
  counts and selections just below, at and above both picker budgets. Saved simulation setup and
  timeline patches with missing metric sources are rejected atomically; valid patches persist.
- UX review: existing selection, counts and recovery flow stay in the import report; no chrome added.
- This performance fix preserves existing output goldens; no golden is re-recorded for the fix.

## Autoscaling A2 round 2 review fixes (#125, 2026-10-15)

- Large and selected namespace imports retain KEDA broker and consumer-group dependencies within
  the picker budget. Missing sources produce an unsupported-policy recovery report. The report
  explains automatic inclusion and counts the boundaries currently selected.
- RabbitMQ imports infer omitted/auto protocol from HTTP(S) or AMQP(S) hosts. Connection reversal
  rejects broken scaler bindings; colliding clipboard node/edge IDs keep distinct remappings.
- Fixed scaling keeps resource editing and the workload lesson in Advanced. Applying the lesson
  restores focus to CPU cost. Node/stencil patches and inferred connections validate together once;
  title and description typing no longer validates the graph.
- Copy tests assert exact policy/source identity; unavailable metrics cannot wake a sleeping fleet.
  Rebased onto master, retained both documentation histories and regenerated the skill viewer at 1.1.26.
- Round 2 changes only `node/i18n/catalogs.json`: three translated messages for current boundary
  selection, automatic scaling-source inclusion and omitted-policy recovery update counts and hashes.
  The other 1,853 goldens, including every simulation and export, are unchanged. Details and verification:
  `docs/PARITY.md` and `docs/research/autoscaling-a2-round2-review.md`.

## Relationship dropdown review fixes (#122, 2026-10-15)

- Removing an inert edge setting returns keyboard focus to Label, and Tab reaches the relationship
  trigger in the same position as the previous select. Collapsible sections still return to their heading.
- The relationship dropdown announces its selected value (including Mixed), links to its actual menu,
  and closes on a second trigger click. Keyboard selection and Escape return focus to the trigger;
  outside clicks keep focus on the control clicked. Message and Request keep async/sync in hints only.
- Browser regressions cover keyboard selection/cancellation, popup accessibility, repeated trigger
  clicks, bulk Mixed values and the actual SVG paths for every relationship glyph.
- Refreshed the stale agent skill viewer; plugin 1.1.25 is one patch above master. No parity goldens
  change: this review changes inspector interaction, not diagram output.
- Merged the latest master without rewriting collaborator history, retaining both documentation
  histories and the follow-up fixes in #123.

## Autoscaling A2 — KEDA and Kubernetes import (2026-10-15)

- KEDA 2.18 ScaledObject lessons observe actual Kafka group lag, Service Bus queue/subscription messages,
  SQS visible/in-flight messages and RabbitMQ ready/unacknowledged messages. Strict activation, cold starts,
  per-trigger caching, polling, independent final-zero cooldown and fallback feed A1's HPA and lifecycle.
  Kafka's controller cap remains separate from partition assignment; spare workers can serve other inputs.
- Kubernetes manifests now persist resource quantities, HPA targets/behavior and executable KEDA settings.
  Exact namespace/kind/version and ownership checks prevent double controllers. Unsupported fields,
  visibility, multi-container accounting and ScaledJob execution are explicitly diagnosed; conflicting
  policies retain safe bounded summaries. Workload costs remain unmeasured until explicitly acknowledged.
- Four main inspector fields, translated Advanced settings and shared planning/check explanations disclose
  polling backlog and startup. The new public **Render workers sleep between bursts** example is tagged
  Autoscaling and demonstrates zero → burst activation → drain → zero within ten simulated seconds.
- The expanded per-step seeded oracle also found and fixed stale retry retention that could return the
  same work twice and make broker lag negative. A larger 5,000-seed run also exposed sampled retained-retry
  memory being clipped by ready-only admission during replica drain; both exact and sampled memory
  integrals now retain those attempts through the drain.
  KEDA activation no longer consumes HPA's growth budget.
- Parity: existing legacy/A1 diagram outputs are unchanged. New goldens cover the three frozen A2 diagrams,
  the public showcase and synthetic import. Seven existing goldens change deliberately: `node/agent/tools.json`
  and `node/skill/public-schemas.json` add A2 schema support; `node/skill/files.json` updates format/spec hashes;
  `node/skill/current-stencils.json` reflects example popularity; `node/skill/validate.txt` lists the new corpus;
  `node/i18n/catalogs.json` adds eighteen translated messages; `node/imports/kubernetes.json` gains executable
  KEDA/resource settings and the policy note while retaining the range summary. See `docs/PARITY.md`.
- Refreshed the offline skill viewer and released plugin 1.1.25, one patch above origin/master.

- Review fixes preserve opted-in Deployment resources with Fixed scaling, reject topology edits that would
  break node or saved-simulation metric bindings, retain positive replica bounds at fractional Capacity ×,
  and keep unsupported resource imports recoverable. Accepted source bindings retain keyboard focus;
  refused bindings remain visible with translated feedback. Fixed/HPA inspectors avoid broker graph copies.
- Refreshed the offline skill viewer and released plugin 1.1.26, one patch above origin/master.

## Autoscaling preflight follow-ups (#117, 2026-10-15)

- The engine classifies all reachable property actions. Shared allocation projection and patching
  serve preflight and setters; ordered preflight takes O(N + A) work and preserves intermediate refusals.
  The 5,000-node/1,000-action operation test counts 7,000 contributions; the old implementation visits
  5,000,000 nodes. Unrelated actions do not project the graph or copy playback state.
- Resource and HPA replacement refusals now exercise real limits during step and resume, preserve
  the entire operation and recover with an exactly-once retry. Partial jittered readiness now has
  a browser test that observes changed readiness before completion while speech stays coalesced.
  Existing coalescing behavior is retained; duplicate findings share fixes and correct cleanup stays intact.
- Refreshed generated skill implementation and the offline viewer at plugin 1.1.24, exactly one patch
  above master. No schema, public contract or parity golden changes: all 1,761 records match unchanged.
- Final validation: 7,169 unit tests pass (four existing skips), 199 production Chromium checks pass,
  and build, size, i18n, skill freshness, lint, typecheck and formatting pass. Initial stale validator-mock
  and generated-file failures were corrected; deliberate negative controls fail as intended.
  Detailed triage, rejections and verification: `docs/REVIEW-FOLLOWUPS-1.md`.

## Phone playback follow-up (#120, 2026-10-15)

- Expanded AI docks reserve space for phone playback, keeping the footer and keyboard focus visible.
  Opening viewport-wide Live panels folds the dock, including when resizing into the phone layout.
- Production regressions check exposed playback/footer controls and Inputs folding independently;
  removing either fix fails its check. The designer review found no added chrome or blocking issue.
- All parity goldens remain unchanged; this corrects the phone layout without changing diagram output.

## Boundary and caption follow-ups (#115, 2026-10-15)

- Custom captions use renderer roots in the editor, Lab and overlap audit. Adjacent fills stay
  separate; overlapping fills follow their spatial paint stacks. Geometry/color invalidation,
  cached results and bounded spatial work keep unrelated updates cheap. Exhausted work uses theme ink.
- Import repairs missing original boundary parents before ID remapping, so a generated ID cannot
  attach unrelated content. The generated agent validator carries the same repair.
- Regressions cover descendant-ID collisions, zone-only entry/exit, all caption writes, host parity
  and operation counts; deliberate reversions fail. All 1,761 parity goldens remain unchanged.

## Gallery launch and Save follow-ups (#118, 2026-10-15)

- Returning to editing cancels a simulation queued while Live downloads. Host publication only
  consumes a ready request; the matching owner activates Live once per launch.
- Regression coverage now makes cancelled requests consumable and checks fresh Save destinations
  after leaving an unedited example, including late picker completion and the reopened copy.
  Existing unmount cleanup was correct and is retained.
- Production gallery/picker/interop checks and deliberate reversions pass. No parity golden changes.

## Browser parity integration with master (2026-10-15)

- Restore a fitted opening frame and immediate refits when panels or Auto-layout change the canvas.
  Font and geometry readiness refine the automatic view; any input cancels that refinement before
  the gesture is handled, including a node press, menu, wheel or keyboard command. Active fit
  transitions stop at the current viewport too, so they cannot move a target under the pointer.
  Regressions hold font readiness to check the first visible frame, a stationary node press and
  a panel opened during a pending refinement, plus keyboard zoom before the first refinement.
  Hover and keyboard focus keep their tooltips by cancelling the pending refinement too.
  Early fits follow React Flow's committed nodes/edges rather than every pane resize, preserving
  fullscreen refits and fitting Auto-layout before its next font refinement.
  The Lab accepts zero-area boundaries while waiting for every visible descendant to measure.
  Eight regressions cover these windows and fail with their fixes temporarily reverted.
  All 1,769 parity goldens remain unchanged: zero changed or added, with none re-recorded.
- Complete correction verification: all six local CI shard lists pass 1,300 tests, and the
  47 previously failing tests pass all 141 three-repeat runs, without retries. Two fresh full
  parity runs and four alternating Docker stress runs are clean. Unit tests pass 7,201 with
  four existing skips; build, size, i18n and refreshed skill freshness pass. Detailed negative
  controls, preliminary failures and local dev-runner corrections are recorded in `docs/PARITY.md`.
- Final P2 follow-up: the title-card warning count waits until the opening viewport is computed
  (or the person takes control). Checks still run independently; delayed fonts, measurements and
  worker delivery produce the same opening view without a harness override or a blank warning row.
- Measurement transactions disconnect their ResizeObserver and clear retained elements when idle,
  then register current targets on the next request. Folded cards reuse their expanded footprint
  across padding/hover notifications, invalidating it for content and available-width changes.
- CPU stress now awaits throttling before every context-created page is returned, including offline
  exported viewers. A page-event-only callback was rejected because navigation could race its CDP command.
- All four regressions fail with their respective fixes temporarily reverted: different opening
  viewports, retained idle observations, repeated expanded-card clones and an unthrottled viewer.
  No golden is re-recorded for these fixes; no controls or reserved blank chrome are added.
- Final P2 verification: six final-build Docker stress passes (24 workers alternating with 10× CPU
  and eight workers), two fresh full-parity passes with all 1,769 goldens unchanged, 7,201 unit passes
  (four existing skips), 138 production Chromium passes and six positive regression repeats.
  Build, size, i18n and the refreshed 1.1.26 skill viewer pass; initial fixture corrections and
  negative-control evidence are recorded in `docs/PARITY.md`.
- Review fixes: Undo cancels Auto-layout while measurements are pending, preserving the prior
  document and history. Other edits/replacements invalidate that waiting layout in the editor.
- User viewport movement cancels interrupted fits and releases the measurement observer without
  discarding measurement subscribers. Rendered zero-axis boundaries include sub-pixel dimensions;
  their descendants still measure normally. Delayed Checks coverage matches dev and built URLs.
- Each review regression fails with its fix temporarily removed. Every parity golden remains
  unchanged in this follow-up: zero changed or added; none were re-recorded.
- Final review verification: six clean Docker stress passes, 1,769 unchanged parity goldens,
  7,201 unit passes (four existing skips), 136 production and 18 dev browser passes. Build, size,
  i18n and skill freshness pass; early harness/resource failures are recorded in `docs/PARITY.md`.
- Rebased the deterministic fits onto nested boundaries (#115), the example picker/gallery (#118)
  and Autoscaling A1 (#117), including the subsequent review follow-ups (#123). Autosave,
  example-copy promotion and CopyNotice are retained alongside the measured fit gate. Both
  documentation histories and both Lab fixtures are preserved.
- Auto-layout refits nested boundaries from the inside out, including measured annotations and
  each child's new bounds, regardless of file order. Membership survives; empty boundaries remain
  valid. Ordered layout commands still finish before the final measured fit. The new Lab fixture
  covers three empty boundary levels, a note, a zone and an empty leaf.
- Parity readiness accepts an explicitly zero-sized boundary while still measuring its descendants
  and recording the boundary. No rendered output is omitted or loosened.
- Gallery save-count and nested-drag regressions wait for the measured opening fit before sampling.
- Regenerated the released viewer from master's copy; plugin 1.1.26 is one patch above master.
- The eight showcase additions and the two complete-selection Tidy corrections are described under
  Deterministic canvas fits below. No other existing golden is intentionally changed.
- Verification: eight Docker stress passes, two fresh full-parity passes (1,769 goldens each),
  7,184 unit passes (four existing skips), and 161 production Chromium passes. Details and the
  initial test-readiness failures are recorded in `docs/PARITY.md`.

## Example gallery integration with master (#118, 2026-10-15)

- Rebased the gallery onto nested boundaries and zones (#115), the six showcases (#120) and the
  nightly reliability fixes (#121). Both Lab presets and both sides of the design/release history remain.
- Showcase metadata uses the existing tags: Partitions for partitions-vs-subscriptions and
  shared-worker-pool, Network devices for contoso-dmz, and Rate limits for shared-api-quotas. Rate-limit
  discovery now recognizes explicit positive API quotas as well as rate-limiter stencils. The measured
  capacity and serverless concurrency examples stay untagged: none of the existing tags describes them.
- Regenerated the agent skill and HTML viewer; plugin 1.1.22 is exactly one patch above master.
- Parity: only `node/i18n/catalogs.json` changed. It combines both PRs' messages: 1,689 per language,
  retaining master's nested-boundary `edit` hashes and adding the gallery's 17-message `examples` area
  in all 38 languages. All other 1,633 goldens are unchanged; the eight existing browser deferrals remain.

## Autoscaling A1 final review fixes (2026-10-15)

- Timeline lifecycle edits preflight allocation configuration before advancing. Unrelated edits
  take no rollback checkpoint; preflight retains only three allocation fields per node, independent
  of queued traffic and graph depth. Refusal still preserves the entire caller-visible operation.
- Scaling speech announces startup completion even for fixed fleets and manual replica overrides,
  while coalescing intermediate jittered readiness changes. No controls or chrome were added.
- Continue refusal recovery now has controller coverage, including an exactly-once retry. Sampled
  retained-memory estimates must stay within 5% of exact memory in both directions.
- These review fixes preserve every parity golden; deliberate regressions verify the new guards.
- Rebased onto the Examples gallery and diagram picker (#118), retaining both features and both
  documentation histories. Autoscaling now filters to the existing Kafka worker showcase, with
  its label translated in all 37 catalogs. Regenerated from master's skill files and released
  plugin 1.1.23, exactly one patch above master. The policy-persistence browser check follows the
  gallery's owned copy after the first edit; the DLQ browser check waits for the live topology
  reload before injecting, so the reload cannot discard its new traffic.
- Rebase parity re-records only `node/i18n/catalogs.json`: 67 existing A1 messages plus the new
  Autoscaling tag raise master's message count from 1,689 to 1,757; only admission, autoscaling and
  examples hashes change, with fallback counts unchanged. The five other A1 metadata goldens
  (public schemas, agent tools, skill files, current stencil ranking and validation records) and all
  127 A1-specific additions remain unchanged. All diagram-output goldens match. See `docs/PARITY.md`.

## Autoscaling A1 refusal recovery review fixes (2026-10-15)

- Refused timeline edits and Continue actions restore the entire run before pausing. Correcting the
  live inputs and trying again preserves pending actions, traffic credits and simulation time.
  Slow-motion forecasting stops on refusal so its sandbox restores before publishing.
- Lowering concurrency preserves sampled memory for existing reservations until they finish; new
  work still respects the lower limit. The seeded oracle detects replacement admissions above it
  and checks that refused actions are a no-op, including the next successful step.
- Scaling speech updates at controller syncs instead of every readiness frame. Staged editor changes
  preserve unchanged node and connection identities, avoiding whole-diagram updates while typing.
- No parity goldens change for these fixes; frozen scenarios do not exercise these transitions.
  Refreshed the offline viewer; plugin 1.1.22 is one patch above master. Both nested boundaries/zones
  and A1 behaviour are retained. The startup assertion follows resource validation into the existing
  preloaded hierarchy chunk, with the validator explicitly pinned and entry budget unchanged.
- Rebase parity regenerated only `node/skill/public-schemas.json` (combined hierarchy/A1 schema
  hashes, sizes and legacy definitions) and `node/i18n/catalogs.json` (A1 messages and the existing
  numeric-error translation). Other shared changes relative to master remain A1's
  `node/agent/tools.json` (resource/HPA contracts), `node/skill/files.json` (A1 format/spec and frozen
  stencil ranking), `node/skill/current-stencils.json` (A1 showcase popularity), and
  `node/skill/validate.txt` (six A1 validation records). All 127 A1-specific additions are unchanged;
  no non-autoscaling diagram output changes, including the six master showcases. Details: `docs/PARITY.md`.

## Nested boundaries final verification (#115, 2026-10-15)

- Removed boundary and annotation parents stay removed after autosave and library duplication.
  Pasted annotations join the boundary at their destination while copied subtrees keep their links.
- Native, storage and clipboard validation share the parent-cycle sanitizer; repaired native links
  produce warnings, and every boundary remains keyboard reachable. Unsupported clipboard tones
  normalize to neutral, and preset lookups ignore inherited properties.
- Ctrl+G includes selected boundaries. Copy and drag use indexed descendant traversal, and undo
  selects the moved boundary without its carried child boundaries or annotations.
- Custom captions share canvas-background measurement and include visible zone and boundary fills
  in their contrast checks. Preset captions skip measurement. Conversion rejects boundary labels
  above the annotation text limit without changing the diagram; labels exactly at the limit survive reopening.
- Refreshed generated skill code and its viewer, retaining plugin 1.1.21 (one patch above master).
  The shared sanitizer adds a small preloaded `groupHierarchy` chunk; the startup assertion pins it
  explicitly, with the entry size budget unchanged.
- Parity: only `node/i18n/catalogs.json` changes. The translated conversion text-limit error adds one
  message and changes the `edit` hash in all 38 catalogs; fallback counts remain unchanged. All
  diagram, simulation, layout, import, export and browser goldens stay unchanged.

## Nested boundaries review fixes (2026-10-15)

- Moving selected boundaries and wrapping them with their selected contents preserves their existing
  nesting, including nodes and annotations. Tab reaches enclosing boundaries before their contents.
- Boundary-to-zone conversion checks annotation geometry and count limits before changing anything,
  with recovery guidance when refused. Annotation membership uses the same geometry in drag previews
  and drop settlement.
- Clipboard boundaries receive unique IDs, valid parent references and an acyclic hierarchy before
  rendering. Indexed subtree traversal avoids repeated work during adoption, wrapping and drops;
  operation-count regressions cover child-first hierarchies at eight times the input size.
- Custom boundary names remain readable, with the chosen colour in the outline and swatch. Custom
  caption colours are retained when they meet AA against the actual canvas, including theme, tint and
  transparency; otherwise they use theme ink. Refreshed the agent viewer (plugin 1.1.21).
- Parity: the only changed golden is `node/i18n/catalogs.json`: the new annotation-limit conversion
  error adds one message in all 38 languages and updates their `edit` hashes.
  Diagram, simulation, layout, export and browser goldens remain unchanged.

## Example gallery verification fixes (2026-10-15)

- An example's completed Save destination belongs only to its mounted session and first owned copy.
  Reopening the original asks for a new destination, including when the first copy is Private. Legacy
  example bindings stay stored but are no longer reused: they cannot identify which copy owns the file.
  Late saves from an unmounted original cannot attach to a reopened session.
- Gallery and command-palette simulation launches share one document-scoped queue; the latest request
  wins while Live loads. Navigation cancels requests for the previous diagram.
- Example conversation snapshots and parsed threads share the four-entry memory cache. Mounted
  conversations stay pinned; inactive entries reload from storage, including its snapshot-free fallback.
- Selection-only changes no longer schedule an immediate example autosave. Gallery tests tolerate
  additional local entries through a synthetic Lab catalog, and pending device/cloud saves are covered
  through the actual controller. No new controls or chrome.
- No parity goldens change. Diagram, simulation, layout, export, agent and language output is unchanged.
  Refreshed the agent skill viewer; marketplace version remains 1.1.21 (one patch above master).

Verification: 6,535 unit checks pass (four existing skips). The production browser sweep passed 398
checks and found two old persistent-binding assertions; those assertions now check the owned file,
and all 35 follow-up checks pass. Deliberate regressions fail for every finding. All 1,634 parity
goldens match, with the eight previously documented browser deferrals.

## Example gallery round 5: copy-only promotion (2026-10-15)

- Promotion copies the current conversation into a new document with a fresh identity. It never
  changes or deletes the example's conversation, session marker, autosave or destination. Examples
  keep a stable identity; legacy keys are read-only fallbacks. Other tabs keep their work.
- Removed session migration, its retries and identity caches, and promotion-time cleanup. Old entries
  remain: they are small, and reclaiming them is unnecessary risk to live tabs. The canvas mount stays
  separate from document identity, preserving Undo, unread AI counts, copy naming and gallery flows.
- Conversation saves and promotion share the snapshot-dropping storage fallback. Failed publication
  rolls back only the new copy; the existing storage notice and retry preserve pending edits. Pending
  saves follow their first copy once, for the operation's lifetime; Private copies block cloud writes.
- All six round-5 findings are addressed, consolidating the three reports of the same cross-tab loss.
  Ownership rotation, conditional deletion, migration debouncing and cleanup timers were rejected in
  favor of eliminating those transitions. The lazy-load race gate matches development and build URLs.
- No parity goldens change: diagram, simulation, layout, export, agent and language outputs are unchanged.
  The skill viewer is refreshed; plugin version 1.1.21 is exactly one patch above master.

## Autoscaling A1 final verification fixes (2026-10-15)

- Keyboard Save commits a valid focused autoscaling number before taking the document snapshot;
  incomplete and refused drafts keep their existing validation and remain editable.
- Admission settings and endpoint durations now intersect CPU execution capacity in routing and the
  capacity overlay. Sampled in-place retries retain memory through backoff and repeated attempts.
- Sampled downscales sweep removed cohorts once per attempt, and CPU intervals cache their budget
  keys. Checks index resource-warning targets once. These performance fixes preserve output.
- Run validates the complete simulation draft against its diagram before replacing the current run.
  Runtime lifecycle refusals pause playback with the existing recoverable notice. Correcting a draft
  or restarting remains available.
- Queued insertions report their staged acceptance and commit their nodes and edges together. HPA
  policy history records actual applied changes after reconciliation. Lowering concurrency preserves
  existing reservations while gating new work, including under invariant verification.
- Selected-node scaling announcements remain accessible with Live details closed, without adding
  visible controls. The seeded fuzzer now checks CPU capacity with admission, retained retry memory
  and concurrency edits; a resource-less p3-to-A1 regression covers exact and sampled playback.
- Refreshed the offline skill viewer; plugin version remains one patch above master (1.1.21).
- No parity goldens change. The frozen scenarios do not exercise these failure paths; focused
  regressions, deliberate reversions and the expanded fuzzer cover them without re-recording output.

## Deterministic canvas fits and browser parity (2026-10-15)

- Opening and Auto-layout fit the rendered, measured result after fonts and floating chrome settle. Boundaries use
  measured card sizes; the title card keeps an up-to-date expanded footprint while folded. Competing opening fits
  and guessed fit delays are removed.
- Auto-layout commands run in order and survive later fit requests. Checks refits after its lazy card mounts;
  zero-sized imported boundaries no longer block fits or Auto-layout. The canvas observes subtree mutations only
  while measured work is pending, leaving idle drags and live decorations free of that observer.
- Browser parity waits for fonts, measured nodes, pending fits and stable geometry; changing badge text cannot
  prevent convergence. CPU-throttle and parallel-worker stress options are documented in `docs/PARITY.md`.
- Refreshed the Claude Code viewer with the same fit behavior; the plugin is 1.1.21.
- Interactive HTML parity now pins the viewer's own opening fit again: the fit waits for fonts, measured nodes and
  settled chrome, so the explicit zoom-and-fit steps added by the toolchain review are no longer needed.
- Browser parity restores eight showcase goldens deferred by #120: opening renders for `contoso-dmz` and
  `shared-api-quotas`; Auto-layout/Tidy for `contoso-dmz`, `measured-order-capacity`,
  `partitions-vs-subscriptions`, `serverless-burst-buffer`, `shared-api-quotas` and `shared-worker-pool`.
  The harness skips Undo after a layout that changes nothing, verifies the entire selection before Tidy, and
  reads connections whose ids start with `deny-` without mistaking their nested deny markers for connections.
  Layout parity waits for deferred warning counts to render before fitting, so their title-card row cannot race it.
- Corrected only the Tidy portions of two existing browser layout goldens: `aws-fanout` had omitted `client`
  and `rag-assistant` had omitted `user`, because Ctrl+A outside the canvas left Undo's changed-node selection.
  With everything selected, AWS correctly reports no room within its boundary constraints and keeps its original
  2240×632 boundary; RAG includes the chat-to-API connection and lays out all 13 nodes (API at 427,160 rather
  than 40,250). Routes and labels follow those corrected positions; all other existing goldens are unchanged.

## Showcase review fixes (2026-10-15)

- Phone Live menus and expectation summaries remain visible and usable with Inputs open. Inputs stays
  above playback and supports changing traffic and closing the panel at 390×844.
- Viewport-wide phone controls belong to the app shell; Interactive HTML playback stays inside its
  canvas above the export date and read-only footer. Refreshed the offline skill viewer for this fix.
- Regression screenshots now go to ignored `tests/.output` paths. Only the curated Round 41 captures
  remain in the showcase documentation; routine tests never refresh them.
- Recorded the exact eight temporary browser parity deferrals in `docs/PARITY.md`, to restore after
  `test/parity-browser-stable` lands. All 1,634 parity goldens match; these review fixes change none.

## Nightly reliability (#114, 2026-10-15)

- Dev tests wait for lazy tools, live sessions, file messages and export templates, intercept the dev image module as well
  as the production chunk, and split repeated navigation sweeps into smaller tests. Large imports use
  the navigation deadline. Vite reloads now fail explicitly, and dev-server output stays in CI logs.
- Typing regressions compare same-run main-thread CPU work through paint, excluding worker CPU contention
  and frame scheduling noise. Stress measurements omit DOM trace snapshots and retain the 1,500-node
  diagram and 1.5× ratio. Simulation samples start after worker progress arrives; the checks test
  retains its per-key run counts. Cancellation tests keep the same traffic on a smaller canvas.
- Application output is unchanged; no parity goldens changed.

## Autoscaling A1 round 4 review fixes (2026-10-15)

- HPA owns replica editing consistently in single and mixed bulk selections. Refused capacity inputs
  announce recovery guidance and retain the previous accepted inputs.
- Retry refusals release reservations; disabling resources clears working, queued and staged attempts.
  Memory metrics include the final processing quantum, paused retries retain their backoff, and small
  fleets make progress under fractional percentage downscale policies.
- Sampled CPU accounting has a shared 20,000-part limit, checked before allocations and lifecycle
  splits. Excess work waits without losing messages; the existing live notice explains recovery,
  including scripted/manual bursts. Metric windows are cached until their actual membership changes;
  readiness defers replica-index rebuilds until an inspector requests a page. Aggregate and per-replica
  inspector readings share one clock when opened between live publications.
- Persisted resource schemas now require p3-a1, including simulation setup and timeline patches.
  The general edit-property schema remains separate. A 200-seed per-step invariant suite runs with
  unit tests; nightly expands it to 5,000 seeds and failures print a reduced reproduction. Seed 3
  additionally found a missing pause timestamp when resources are enabled on a paused service.
- Three shared parity goldens change for A1 contracts/copy and the rebased example inventory: `node/skill/public-schemas.json`
  records revision-aware diagram v1/v2 schemas; `node/i18n/catalogs.json` records the added A1 CPU
  recovery message and its English fallbacks; `node/skill/current-stencils.json` combines the A1
  showcase with six showcases from the rebase in the current stencil ranking. All diagram outputs,
  including every A1 run, and all
  browser goldens remain unchanged. Details: [round 4 review](research/autoscaling-a1-round4-review.md).

## Autoscaling A1 round 3 review fixes (2026-10-15)

- Saving Capacity × now applies the saved HPA policy and multiplier together, preserving the running
  fleet. Paused services retain startup time and draining grace, including sampled work and checkpoints.
- Node creation, paste, duplicate and property edits share persisted-resource validation with native
  reads. Invalid null settings, older-model A1 properties and oversized merged fleets are refused;
  a refused A1 paste offers the model-upgrade preview. Unrelated property typing skips resource
  schemas and lifecycle-budget scans. Live overrides preflight the whole proposed allocation.
- Model previews switch independently with accurate disclosure states. Replica pagination uses an
  ID/rank index for jittered startup, avoiding repeated scans during inspector refresh.
- No parity goldens changed: legacy, non-autoscaling and A1 outputs remain identical. Existing frozen
  runs do not include these save/pause/invalid-edit cases; regression tests cover them separately.
  The offline viewer is refreshed; plugin 1.1.20 is one patch above current master.

## Example gallery round 4 review fixes (2026-10-15)

- A failed conversation migration keeps the mounted canvas identity through storage recovery.
  Pending edits, promotion, autosave, Undo and Redo survive without remounting the canvas.
- Examples retain one durable reload conversation. Mounted tabs keep independent snapshots;
  promotion transfers the conversation into its owned diagram. Abandoned generations are reclaimed,
  while active tabs and library-owned conversations remain available. Clear and Delete reclaim their data.
- Public gallery runs wait for their document's live session and cancel after navigation, so an earlier
  run cannot replace another diagram's requested simulation. No controls or visible wording were added.
- Browser persistence assertions share one reader that follows the current owned slug, unwraps sessions
  and requires a diagram. Cross-tab coverage awaits the receiving storage event and rendered library update.
- All nine review findings were confirmed, with duplicate reports consolidated into five fixes.
  No findings were rejected. Durable example conversations avoid adding ownership leases or cleanup timers.
- No parity goldens change in this round. The skill viewer was refreshed, with plugin version 1.1.20
  (one patch above master); diagram, simulation, planning, layout, export, agent and language outputs stay unchanged.

## Toolchain review fixes (2026-10-15)

- CI and nightly share pnpm/Node setup, dependency caching and frozen installs. `package.json` owns
  the pnpm version, so upgrades no longer require matching workflow pins.
- Dependency-policy tests prove synchronized commands work and stale commands fail specifically
  during dependency verification, without rewriting the lockfile. App output and parity goldens are unchanged.
- Interactive HTML parity fits the settled viewer explicitly, avoiding a startup-framing race; its
  existing goldens remain unchanged.

## Autoscaling A1 round 2 review fixes (2026-10-15)

- Concurrency edits refresh replica availability, and work waits for a successful reservation.
  Starting replicas cannot reverse a shrink recommendation into growth. Retained retries respect
  delivery limits during outages without requiring CPU progress. Enabling resources queues existing
  work that does not fit the new fleet.
- Numeric and Advanced JSON edits validate complete resource/policy candidates. Incomplete optional
  numbers preserve saved values with feedback, metric windows account for delay, and JSON stays
  left to right in RTL languages. Paste, duplicate and single/bulk resource edits reject a merged
  lifecycle budget that could not reopen, preserving queued edits and giving recovery guidance.
- Sampled admissions avoid rescanning unchanged work, jitter hashes node identity once per fleet,
  draining readouts use maintained counts, and replica pages expand only their fifty requested rows.
  Exact replica CPU readings now match the aggregate before and after fifteen seconds.
- All 1,552 parity goldens remain unchanged, including legacy, non-autoscaling and A1 outputs; none
  were re-recorded. Existing corpus scenarios do not trigger these corrected edge cases. See
  `docs/PARITY.md` and `docs/research/autoscaling-a1-round2-review.md` for the full accounting.
- Refreshed the released offline viewer; plugin version is 1.1.19, one patch above merged master.

## Autoscaling A1 review preparation (2026-10-14)

- Added **Image workers absorb a burst**, a public Kafka/HPA example with two saved simulations.
  Workers start, backlog builds and drains within ten simulated seconds; selected Live details show
  replica history. Short controller timings are explicit teaching assumptions.
- Restored exact legacy capacity arithmetic: workers without resources retain their replica
  recommendations, including exact rounding boundaries. draw.io round trips now preserve a v2
  A1 diagram's planning revision so reopening an A1 export keeps resource execution enabled.
- Parity changes are confined to A1's public/agent schemas, skill format/spec and the example-driven
  stencil ranking, i18n catalogs with A1 messages, and the validator's six new input records.
  New goldens cover the public showcase and five frozen A1 scenarios, including per-second replica
  counts and explanations for bursts, the five-minute downscale window, maximum reached, idle replicas
  beyond partitions and delayed startup. All existing simulation, check, export, import, layout,
  browser and planning-upgrade goldens remain unchanged. The full accounting is in `docs/PARITY.md`.

## Public feature showcases (2026-10-14)

- Six new examples: **Partitions versus subscriptions**, **Shared API and token quotas**,
  **Serverless burst and buffer**, **Measured order capacity**, **Contoso DMZ**, and
  **Two inputs, one worker pool**. Each has two saved simulations and uses the current planning model.
- Watch idle Kafka readers versus full subscriptions, separate admitted/rejected API calls, shared
  model tokens, reserved function concurrency, measured bottlenecks, firewall blocks and shared worker
  slots. Quotas are explicitly fictional; the async function path uses a bounded invoker, without
  claiming vendor trigger retries. Examples remain lazy and use the existing themes and Lab.
- Public examples increase from 17 to 23, with reviewed checks and light/dark desktop/mobile screenshots
  in [Round 41](DESIGN-REVIEW.md#round-41--public-feature-showcases-2026-10-14).
- Phone title cards wrap the title below Live and fold long descriptions, retaining checks/reset.
  Playback controls stay in one row above the side rails, with Inputs clear of the bar.
- Output parity adds 205 Node goldens (all six examples' output families, individual validation
  transcripts and the updated skill stencil-reference fingerprint) and four stable browser renders:
  partitions, measured capacity, serverless buffering and shared workers. The
  [complete manifest](research/showcase-examples.md) explains every added file. Original aggregate
  skill outputs retain their explicit 17-example input cohort; no existing golden changes.
- Deferred eight new browser measurements pending `test/parity-browser-stable`: Contoso and quota
  initial renders, plus auto-layout/tidy for all six. Their Node goldens and production Live tests
  remain enabled. No existing browser case is excluded.
- Refreshed the stale offline skill viewer; plugin 1.1.20 is one patch above master.

## Example gallery final review fixes (2026-10-15)

- Pending cloud saves follow their initiating session into its owned copy. Marking that copy Private,
  including through New diagrams are private, cancels before provider loading or an upload can finish.
  Privacy checks and destination binding use the same ownership resolver.
- Each tab keeps an independent example session, Save destination, canvas and Undo history. Promoting
  one tab preserves another tab's pending edits; each can keep its own copy. Reloads retain conversation
  snapshots while assigning the new mounted session its own identity.
- Copy creation, library publication and source-session rotation now roll back together on storage
  failure. The first edit still saves immediately; failed retries debounce and show storage guidance once.
- Open and Run it move keyboard focus to the destination canvas after downloading an example.
  Dismissing the gallery still returns focus to its opener. No controls were added.
- No output goldens change in this round. Diagram, simulation, layout, export, agent and language
  outputs stay unchanged; the earlier gallery catalog golden change remains documented below.
  The agent viewer is refreshed; plugin version is 1.1.20, one patch above master.

## Example gallery review fixes (2026-10-15)

- Editing an example keeps its existing device or cloud Save destination. A Save that finishes after
  the edit binds to that owned copy, even after another example session has opened.
- Legacy example conversations, including Revert snapshots, migrate together with retained autosaves
  to a durable session. Reloading preserves the conversation; first-edit promotion carries it into
  Your diagrams. Legacy cloud Save bindings migrate too. A failed migration retains the source data
  and retries later; promotion publishes a fresh example identity so other tabs reject stale writes.
- Shared work always has a picker row, and older saved work remains reachable through Your diagrams
  overflow. Regression tests cover both paths and starting/restarting the currently mounted example.
- The copy notice stacks inside the canvas clear of stencil controls and action toasts. Run it includes
  its translated visible label in its accessible name. Ordinary autosaves reuse their serialized diagram.
- These fixes change no output goldens. The gallery feature's existing catalog golden change is described
  in the entry below; diagram, simulation, layout, export and agent outputs remain unchanged.
  The agent viewer is refreshed; plugin version remains 1.1.19, one patch above master.

## Example gallery (2026-10-14)

- The diagram picker now focuses on Your diagrams, with New diagram and a separate Browse examples entry.
  Recent work is capped, the current diagram stays visible, and the full library remains one step away.
- Browse examples opens a lazy gallery from the picker or start card: thumbnails, short descriptions,
  theme groups, search and a small translated Shows filter. Open edits a diagram; Run it starts its first
  saved simulation in Live. Keyboard navigation, focus return and narrow layouts work in both themes.
- An open original is labelled Example. Its first edit creates an owned copy in Your diagrams,
  using “(copy)” unless you chose a new title. It keeps Undo/Redo and live playback, and shows a quiet notice without replacing an action's Undo toast.
  Reloading a copy and returning to its source opens a pristine example; undone edits stay undone after reload.
  A cleared title becomes an owned Untitled diagram while its input stays empty for typing. Slow example
  downloads keep the edited copy mounted.
- New gallery copy is translated in all 37 locale catalogs. The development-only catalog remains available
  through its existing picker area and the gallery, using the generic catalog boundary. Its saved runs
  start in memory without putting simulation identifiers in the URL, even transiently.
- Output parity changes only `tests/parity/goldens/node/i18n/catalogs.json`: the 17 new gallery messages add
  an `examples` area hash and increase the message count by 17 in each of the 38 languages, including the
  pseudo-locale. Existing area hashes and fallback counts are unchanged. Diagram, simulation, export,
  layout and agent output goldens are unchanged. The agent viewer is refreshed; plugin version is 1.1.19.

## Self-hosting review fixes (2026-10-14)

- Cloudflare Pages preserves static assets through its native SPA fallback. Legacy and target header files
  share directory-aware routes, so cross-origin embed modules keep their CORS headers under a prefix.
- Embed code uses the prepared deployment base on deep routes; nginx redirects stay relative behind HTTPS proxies.
- Hosting-only Docker settings reuse the compiled app layer. Concurrent smoke checks own their containers
  and assigned ports, and clean up only their own container IDs, including after a failed start.

## Autoscaling A1: resources, replica lifecycle and HPA (2026-10-14)

- Opt into resource costs and Kubernetes HPA with a lesson, target and replica range. CPU work and limits
  affect execution; memory risks remain explicit. Other settings live under Advanced.
- Replicas start and drain on simulation time. CPU/memory readouts, replica history and selected replica
  pages explain current readiness and scaling decisions. Partition limits and managed allocation still apply.
- Checks and planning share resource arithmetic, including max-reached and unfixable baseline-memory
  explanations. Older diagrams keep their behaviour until an explicit, undoable model upgrade.
- Native files, agent operations, clipboard and the offline viewer preserve A1. All new UI text is translated
  into all 37 locales. KEDA, cloud adapters and scenario policy sizing are later milestones.

## Planning P3 final review fixes (2026-10-14)

- Planning and playback share normalized admission requirements. Imports reject duplicate quota IDs
  within each API scope and malformed caller policies with clear messages; local and shared limits
  use separate identities. Zero-duration calls still respect zero concurrency budgets.
- Fixed managed fleets scale above their saved size up to their allocation, consistently before and
  after Save. Scalar timeline edits reuse validated endpoint requirements, and checkpoints clone only
  mutable admission state. Capacity analysis indexes and aggregates endpoint calls.
- Bulk managed edits expose the same applicable controls as single selection and preserve each
  node's account and quota settings. Managed services no longer hide editable Inputs rows or inflate
  Show all counts. Zero admission capacity describes rejected calls and the limiting budget.
- Refreshed the agent viewer and native validator; the plugin remains one patch above master (1.1.18).

## Competitive landscape research (2026-10-14)

- Added a [sourced competitive landscape](research/competitive-landscape.md) covering diagram editors,
  architecture modelling, cloud tools and recent system-design simulators, with explicit verification
  limits, canvas comparisons and ranked opportunities. This is research; app behaviour is unchanged.

## Self-hosting kit (2026-10-14)

- Build a non-root Docker image or deploy with Compose, Kubernetes or Helm, including health probes, caching,
  compression and directory hosting. Application switches still apply at build time.
- Generate policies for nginx, Caddy, Netlify, Vercel, Cloudflare Pages, Azure, AWS and GitHub Pages from the
  shared security policy. The guide explains platform limitations, SSO and private embeds.
- Check deployed headers with `pnpm self-host:verify <url>` and create a versioned, checksummed offline bundle
  with `pnpm package:offline`. CI smoke-tests root and sub-path images without publishing them.

## Planning P3 review fixes (2026-10-14)

- Managed consumers respect each Kafka input group's partition assignment and drain prefetched work
  as slots free. Saving Capacity × preserves fixed managed fleets without changing account allocations.
- Capacity analysis and playback share quota identities and implicit account allocations. Endpoint
  budgets cannot collide with parent budgets, and buckets too small for one request have zero capacity.
- Live edits rebuild only affected admission policies; requests reuse compiled endpoint requirements.
  Checks remain deterministic across languages and translate cached rejection estimates when displayed.
- Managed processors retain **Emits** under **Advanced**. Admission fields explain invalid drafts and
  the retained setting, and group Undo by field. Imports reject duplicate endpoint IDs and malformed
  endpoint references; runtime references fail closed.

## Stencil catalog review fixes (2026-10-14)

- Stencil details show the actual saved default under **New nodes say**, while catalog previews retain
  translated subtitles. Add and New diagram therefore produce the text promised by the details.
- Firewall names use network-security vocabulary in French and 13 other affected locales; all 37
  language glossaries now guard names, subtitles and descriptions. Related descriptions use the same
  terminology, including repaired French and Croatian SRX descriptions.
- English and translated discovery share scoring and stable ranking. Exhaustive pseudo-locale checks
  guard display lookups, and browser checks catch vertical clipping and caption overlaps in previews.

## Stencil catalog localization (2026-10-14)

- Generic stencil names, subtitles, descriptions and vendor labels now follow the selected language
  throughout the library, gallery, previews, stencil picker and inspector. Product names retain their spelling.
- Stencil discovery matches translated text as well as English names and aliases. Changing language
  refreshes mounted results and menus while preserving the query and the diagram's own labels.
- Catalog display messages stay lazy. Stored defaults, diagram files, agent search results and schemas
  retain their English contracts; stencil behavior and simulation profiles are unchanged.

## Custom colours and canvas tint (2026-10-14)

- Annotations now support custom hex colours and a full palette, including transparency. A diagram's
  background tint follows light/dark themes, presentation, embeds and Interactive HTML exports.
- Inspecting and dismissing a picker leaves untouched colours and Undo history unchanged. Keyboard
  focus stays in the picker and returns to its opener; each colour edit is one Undo step.
- Custom annotation ink stays readable. Hex paste accepts `#`, reset restores defaults, and native files,
  draw.io and the offline agent checker share the same lossless colour contract.
- Thanks to **Heiner Morales** for the custom colours, palette picker and background tint design in
  [PR #102](https://github.com/latchkostov/diagrams/pull/102).

## Planning P3: managed compute and external limits (2026-10-14)

- Functions and external/model APIs process duration and errors and refuse calls that exceed
  concurrency, rate or token/cost budgets. Live shows Rejected separately from failures and losses.
- Versioned Lambda, Stripe and API Gateway presets cite scoped vendor quotas. Visual nodes share
  account budgets; declared endpoint budgets apply alongside global budgets. Unknown limits stay unknown.
- The inspector offers a preset and at most four main controls, with account scope and scaling details
  under Advanced. Local rate edits preserve the account cap. Automatic function scaling is explicitly
  a simplification; caller deadlines, retries and failure cascades remain deferred.
- New diagrams use p3; earlier models keep their playback until an undoable upgrade. The new controls
  are translated in all 37 additional languages, and offline agent exports use the same admission model.

## Planning P2 review fixes (2026-10-14)

- Unread subscription checks keep deterministic English findings for workers and agents; the Checks
  card translates their rationale when rendered, including after a language switch.
- Free play's Capacity multiplier now selects the matching partition or shard label for assigned
  instances and idle badges in mixed-broker diagrams.
- Editing Inputs avoids resolving service and subscription settings just to identify partitioned brokers.

## Planning P2: logs and subscriptions (2026-10-14)

- Kafka and Event Hubs assign reader instances by partitions; Kinesis uses shards. SNS, EventBridge,
  Service Bus Topic, Pub/Sub and RabbitMQ exchange fan-out can use every configured worker slot.
- Inspector and capacity readouts use each broker's vocabulary. Subscription brokers have no partition
  controls, partition preset or partition fixes, and dead-letter routes never count as subscribers.
- New diagrams use planning p2. Older diagrams retain their playback until an explicit upgrade, with
  before/after capacity and Undo. Kafka Cluster remains infrastructure, separate from a topic.
- Producer message size and ingest units are validated metadata without vendor hard ingest limits.
  The broker UI is translated in all 37 additional languages; offline agent exports use the same model.
- P1 legacy downloads remain available before upgrading. Upgrades and Undo refresh an open capacity heat map
  and live run; subscription or queue consumers retain finite network-device throughput estimates.

## Canvas localization review fixes (2026-10-14)

- Stencil search finds translated roles, categories and families, while keeping English aliases.
  Open search panels and menus refresh when a language finishes loading, preserving queries and navigation.
- RTL quick-add stays beside its prospective node in physical canvas coordinates; expanded library
  categories keep their downward chevrons. The diagram retains its direction.
- Command names come from their actions, avoiding mixed-language nouns. Annotation recovery guidance
  follows typed validation reasons, and chrome counts reuse number formatters.

## Planning P1 CI fixes (2026-10-14)

- Live stats cards open below nodes when there is room, flip above when needed, and keep covering
  lower nodes, status rings and capacity badges in both themes.
- Live callouts move clear of nodes as the canvas pans, zooms or resizes, so Properties and full
  consumer-group details remain reachable in short viewports. When the full card cannot fit, a compact
  row keeps its cause and action; the full reason stays available on hover and to screen readers.
- Naming saves each key immediately while planning waits until naming ends. Diagrams beyond the
  planning limit avoid copying the document for that readout; model previews read it only when opened.
- The Lab's inspector-focus preset renders again and retains focus requests until the matching field mounts.

## Planning P1 round 3 fixes (2026-10-14)

- Large or dense diagrams get a bounded, explicit unavailable explanation instead of blocking selection;
  moving nodes reuses the configured plan and sizing result. Current-run counters remain available when an explanation cannot be computed.
- Explanations follow the engine's current settings after Inputs changes, timeline actions and seeking.
  Upgrade and legacy export retain partial timeline edits, and sparse P1 paste preserves playback.
- Paste rejects unsupported preset revisions and invalid planning settings. Copied inferred consumer groups
  follow the new consumer IDs while authored names stay intact.
- Screen readers receive the numerical explanation. Add a consumer keeps keyboard focus on the new Label;
  open hover cards follow pan, zoom and resize. Full observed counters and group lag are available under
  Live details in Properties, including when the hover is compact.

## Planning P1 review fixes (2026-10-14)

- Private diagrams keep their flag in legacy downloads, alongside native JSON and Interactive HTML.
- Upgrade and legacy export preserve effective defaults, device sizes, saved setup and timeline behavior;
  legacy loss reports include metadata in saved simulations.
- Consumer defaults use stable node identities. Live counters reuse configured planning analysis, descriptions
  avoid per-node sizing verification, and incoming-source explanations have bounded text.
- Apply keeps current outages, keyboard focus survives disappearing actions, and tall hover cards fit short
  viewports with full details in Properties. Whole-file paste accepts the new format; sizing uses base replica
  counts consistently.

## Planning P1 (2026-10-14)

- The inspector and live hover card explain processor throughput, incoming traffic, arithmetic and
  a chosen utilization target. Orders at 3 req/s demand and 1 req/s capacity distinguishes three
  replicas at 100% from six at 50%, with one undoable planner fix.
- Read-only Connections rows derive Consumes / Publishes / Calls from current flows. Two input
  policies share one node pool; HTTP-only services have no consumer policies. Removing/reconnecting
  an edge refreshes the readout. A broker without a reader explains its producers and offers Add a consumer.
- Explicit family profiles and pinned lesson/device revisions share playback's resolver with analysis,
  checks and explanations. Existing files retain legacy playback. Diagram properties offers an
  undoable upgrade preview and legacy export with a loss report. Planning files use `diagrams/v2`;
  unsupported revisions are refused instead of substituted.
- Physical delay and store connections/query slots have distinct, bounded metadata contracts; their
  execution models remain deferred. New `planning.*` strings use `t()`; the 37 non-English languages
  currently fall back to English. No top-bar controls were added.

Changes to habits people already have. The app has no "what's new" panel, so they're noted here.

## Canvas menus and stencil chrome in your language (2026-10-14)

- Canvas number formatting stays lightweight alongside Planning P1; the agent skill viewer is refreshed in plugin 1.1.14.
- Right-click menus and their submenus, quick-add, edit feedback and Ctrl+K commands now use the chosen language,
  with translations in all 37 locales. Commands keep their stable identities when a language downloads or changes.
- Stencil categories, families, filters, gallery details, empty states and buttons are translated. Stencil catalog
  names/descriptions and authored diagram content keep their original text. Your diagrams retains its existing
  File-batch translations.
- Longer menu, palette and annotation labels wrap. Arabic mirrors the menus, opens submenus to the left and
  reverses drawer navigation, while diagram geometry keeps its direction. English wording remains unchanged.

## AI language switching fixes (2026-10-14)

- Visible microphone and on-device model errors now update when the language changes, keeping the request drafts.
- New conversation reverts keep their target as metadata, so their labels follow language changes after reload too.
  Previously stored revert labels remain readable in their original language.
- Complete AI shortcut combinations stay left to right inside Arabic and Hebrew sentences and tooltips on macOS.

## AI and keyboard labels in your language (2026-10-14)

- The AI panel's dock, conversation, Advanced copy-and-paste flow, dictation notices and on-device model
  controls now use the chosen language, with translations in all 37 locales. Agent prompts, WebMCP tool
  contracts and results, and diagram content keep their original text.
- Keyboard labels follow the language and OS across the shortcuts sheet, menus, tooltips and palette:
  German Strg and Umschalt, French Maj, and macOS modifier symbols. The sheet's Live and presenting rows
  are translated too. Long labels wrap, and Arabic mirrors the panel while keeping key combinations readable.
- Sending, dictation, inference and pasted replies work with English fallback while a language downloads
  or fails to download. English wording, punctuation and number presentation retain their previous output.

## Properties in live view (2026-10-14)

- Double-click a node, boundary or connection in Live to open its property sheet, even when collapsed, with the
  whole Label selected. F2, Enter, Rename and Ctrl+K do the same. Presentation and read-only viewers stay inert.
  Enter still continues a waiting narration; F2 can open properties while it waits.
- Names use the inspector's existing simulation behavior: node names and subtitles restart the run; boundary
  and connection labels do not. Live's other gestures are unchanged.
- Opening properties makes room beside the canvas by closing Inputs or Simulations. An unsaved simulation
  draft comes back when Simulations reopens.

## File dialogs in your language (2026-10-14)

- Open, import, export, embed, password links and cloud-storage dialogs and messages now use the chosen language,
  with translations in all 37 locales. Counts, sizes and file dates follow that language too.
- Diagram text, code snippets, file formats and product names stay as written. Arabic mirrors the dialogs;
  long translations wrap in the same compact layout, with export options still behind Options.
- Saving to this device and downloading diagram files work while notification messages download, and when that
  download fails. Native Open and Save retain the browser gesture that allows their pickers to open.
- Cancelling Paste also cancels an import waiting for its messages. Import reports follow language changes when
  reopened, including reasons, notes and reports drawn again from retained import data.
- English keeps its previous wording and formatting after extraction: storage failures name their provider,
  image failures name their format, and locked copies retain the warning when someone sends a link. Library
  pagination, detail spacing, import counts and lists, file sizes and traffic units keep their original output.

## External discovery (2026-10-14)

- **Clients & external** brings External API, Webhook, Email, SMS, Mobile Push, Marketing Automation and LLM API
  together with clients and vendor APIs in the stencil library and gallery. Quiet headings separate clients and
  webhooks from called external systems.
- **Iterable, Braze, Segment, Shopify, PayPal and Adyen** now have named stencils with reusable generic glyphs.
  Search them by name or find integrations with “external”, “third party”, “API”, “SaaS”, “webhook” or “vendor API”,
  including Ctrl+K and agents' `find_stencils`.
- This adds discovery only: simulation roles stay as before; no vendor quotas, rate-limit defaults or endpoint editor.

## Inspector naming reliability (2026-10-14)

- Quick-add and Rename keep their focus request until the selected node's Label is ready, including when the
  inspector is opening after a pointer gesture. A previous node's name never takes the request.
- Typing names keeps node positions and connection routes stable until the measured bounds change, avoiding
  repeated routing work on large diagrams. Growing cards and connection labels still update their routes.
- Live callout counts use equal-width digits, so changing digits no longer nudges the adjacent Revive button.

## Naming follow-ups (2026-10-14)

- Typing a boundary name keeps distant connections' routes cached. Connections near its growing or shrinking
  label still update immediately.
- Backspace straight after a quick-add pick keeps the name empty when the inspector opens, ready for typing.
- Regression coverage now checks that clicking away or folding the inspector finishes a rename as its own undo step.

## Renaming in the inspector; selected text you can see (2026-10)

From the owner's reports (docs/DESIGN-REVIEW.md, round 34). Habit changes:

- **Double-click a node, a boundary or a connection to open it in the inspector**, its **Label** focused with all of
  it selected: type the new name, then **Enter** (or **Esc**) to go back to the canvas. Nothing opens on the canvas
  for them any more. **F2**, **Enter** on a selected one and the menus' **Rename** and **Edit label** do the same, and
  open the inspector if it was hidden. **Tab** goes to the Subtitle.
- **Quick-add names the new node in the inspector** (a double-click on the canvas, a dropped connection, Alt+arrow,
  the "+"): type its name straight away, as before. A node made connected shows a **Connection** field one Tab after
  the Subtitle while it's being named. The node, its connection and their names are still one undo step.
- **Texts, notes and zones are still edited in place**: their words are the thing.
- **Selected text shows**, in every field, in both themes. Every editor on the canvas (a boundary's or a node's name,
  a note) painted its selection transparent, so a double- or triple-click selected the words without showing it
  (typing still replaced them). Double-click selects a word and triple-click the line, as everywhere else.
- Live, presentation, read-only views, embeds and the HTML viewer open no editor on a double-click or F2.

## Editing reliability (2026-10-14)

- The inspector stays folded during a drag even when another drop's deferred update is still waiting.
- Run simulations from Ctrl+K or the canvas right-click keeps playing when the Checks card opens in development.

## Simulation review, round 3 (2026-10)

- Live reports losses between trend samples, including the last partial second of a finished run. Broker outages
  say messages were dropped on arrival; delivery-limit losses offer a dead-letter queue. Only playback's selected
  dead-letter route exempts its target from lag warnings.
- Large bursts no longer cost a full travel-array scan every tick or frame. Broker throughput stays unlimited;
  paused sinks ignore saved latency when revived, matching the inspector.
- Continuous traffic keeps the 10,000,000 msg/s input limit, with a sampled rate and per-run source budget. Unsafe
  scale combinations explain how to change Inputs; reaching the volume budget shows a notice and requires Restart.
- Callouts reserve room for Back to editing, and Show events remains usable during slow motion. Adding a dead-letter
  queue is covered through delivery and one-step Undo; staged-backlog tests now require progress and full draining.

## Simulation review follow-up (2026-10)

- A saved sink latency really does nothing: topic delivery stays immediate. Large consumer groups refresh their
  delivery limits without rescanning all routes, and outage details use indexed memberships.
- Live reports losses in short runs, keeps an ongoing lag warning after seeking, and stops calling a flat backlog
  rising. A warning hidden behind Inputs keeps its turn; an unrelated capacity diagnosis no longer hides it.
- A down broker fed by another broker says its messages wait there, matching playback and the heat map.
- Trouble announcements update an already mounted live region, callouts stay clear of the title with the AI panel
  open, and removing a saved inert setting keeps keyboard focus in the inspector.
- Checkpoint restoration preserves consumer IDs such as `constructor`; the on-device DLQ eval requires a route
  playback actually classifies as dead-letter.

## The simulation tells the truth (2026-10)

From the simulation flows review (docs/research/sim-flows-review.md, items 1–6; docs/DESIGN-REVIEW.md, round 32).
Habit changes:

- **Consumers behind a topic or queue keep up at the rate the heat map says.** A default consumer drained about
  3.5 msg/s behind a broker while every number said 16, so "Healthy" sat over a lag that only grew (the GCP example
  did it at "13%"). A delivery now takes its consumer's slot when it arrives. Runs of diagrams with brokers look
  calmer: lag builds only where a consumer really can't keep up.
- **Messages move faster by default**: an edge without its own travel time takes 300 ms (a request 200 ms); it was
  900 / 450. Edges that set one keep it.
- **Live tells you what's going wrong without being asked**: a node that's down (**Revive**), messages being lost
  (**Add dead-letter queue**), a lag that keeps rising (**Inputs…**). Each comes once per run, and **×** dismisses it.
  Nothing appears while presenting, recording or in an embed.
- **A down consumer behind a queue says its messages wait**, "Messages wait in orders until it's back (49 so far)", not
  that they fail.
- **A new connection into a database, gateway or outside API, or out of a browser or app, is a Request** (solid);
  into or out of a topic or queue it's a Message, as before. The first time, a toast offers **Make it a message**.
  Agents' `connect` without a `kind` does the same. Existing diagrams are unchanged.
- **The inspector hides fields that do nothing**: a gateway's Concurrency, a sink's Latency, and Consumer group and
  Dead-letter path on connections that don't leave a broker. A value already saved stays, with a note and **Remove**.
- **Rates go up to 10 million msg/s** everywhere (they stopped at 10,000 in files and the Inputs panel, but not in the
  inspector, so a saved 50,000 wouldn't open again). Fields stop at the file's limits and say so, and a refused file
  names the field: "ratePerSec 20,000,000 is over the 10,000,000 limit".
- **The callout sits clear of the diagram's name** on narrower screens (it covered the title card's first words).
- The chatbot prompt's dead-letter example hangs the queue off the topic (it copied every message from the consumer).

## Languages (2026-10)

- **Live Diagrams opens in your browser's language**, in 37 languages beside English: Arabic, Bulgarian, Chinese
  (Simplified and Traditional), Croatian, Czech, Danish, Dutch, Estonian, Finnish, French, German, Greek, Hebrew,
  Hindi, Hungarian, Indonesian, Italian, Japanese, Korean, Latvian, Lithuanian, Norwegian, Polish, Portuguese (Brazil
  and Portugal), Romanian, Russian, Serbian, Slovak, Slovenian, Spanish, Swedish, Thai, Turkish, Ukrainian and
  Vietnamese. A browser set to English sees no change.
- **View ▸ Language…** (and Ctrl+K, "Language…") picks one: every language by its own name, Browser default first. The
  choice is kept in this browser; **Clear everything on this device…** forgets it, with the rest of your settings. When
  the app isn't in English, the View menu's row also says "Language", in English, so it can always be found.
- **What's translated so far:** the start card, the top bar, the File, View and presenting controls, Share…, the
  keyboard shortcuts, and the Private diagram and Clear everything dialogs. The rest is English for now, area by area
  (docs/I18N.md). **Your diagrams are never translated**: labels, notes and titles stay as you wrote them, and so do
  product names (Kafka, PostgreSQL) and files.
- **Machine-translated, and it says so.** The Language dialog links to a prefilled GitHub issue to suggest a better
  translation.
- **Arabic and Hebrew** read right to left: the top bar, menus and dialogs mirror; the diagram doesn't (it reads the
  same for everyone).
- Numbers, percentages and "5 min ago" follow the language (1.234 in German, "vor 5 Min."); English keeps its wording,
  with thousands now grouped ("1,234 nodes").
- **Self-hosting:** `VITE_LOCALES` limits a copy's languages or sets one for everyone (docs/SELF-HOSTING.md).

## On-prem network devices (2026-10)

Routers, switches, firewalls and load balancers you'd have in your own racks (docs/DESIGN-REVIEW.md, round 31).

New:

- **An On-prem network section** in the stencils, with a **Network vendors** family filter. There are 19 stencils:
  - a generic Router, Switch, Firewall (NGFW) and ADC;
  - Cisco ISR, Catalyst, Nexus and Secure Firewall; Juniper MX, EX, QFX and SRX; Arista; HPE Aruba CX;
  - Palo Alto NGFW, FortiGate, Check Point Quantum, F5 BIG-IP and NetScaler.
- **Search finds model numbers and jargon.** "3825" or "ISR" finds the Cisco router; "BIG-IP", "NGFW", "spine" and
  "leaf" work too. They're drawn as device glyphs, with the vendor as the stencil's name and colour.
- **Sizes.** A device's Simulation settings start with **Size** (branch, campus or data centre). Each size's throughput
  and latency come from a named model's datasheet, for example "Campus: PA-3440, 20 Gbps". A note says what that is in
  messages per second at the **Message size** (64 kB unless you change it). Every number is approximate and yours to
  change.
- **High availability.** A device can be an **active-standby pair** (one unit carries traffic; when it fails, the
  standby takes over in a few seconds and nothing is lost) or an **active-active cluster** (the units' throughput adds
  up). In live view, a pair's Behaviour menu has **Fail the active unit**.
- **Firewall rules.** A connection leaving a firewall is a rule: **Allow** or **Deny**, in its inspector. A denied one
  shows a "no entry" glyph. In live view what it stops shows as **blocked** on the firewall, never as failed, dropped
  or lost.
- **Load balancers health-check their targets.** An ADC (F5, NetScaler, the generic one) sends nothing to a target
  that's down while another is up.
- **Capacity sees the devices.** Show capacity and the Inputs & capacity panel colour a device against its throughput
  ("1% · 440/s of 39k/s"). Check diagram's "can't keep up" offers the next size up, and "every request goes through
  one" offers **Make it an HA pair**.
- **A new example**, Branch office to data centre, with two simulations: one firewall fails over, and the firewall
  blocks the branch from payments.
- **draw.io imports** read the Cisco library's routers, switches, firewalls and load balancers.

Nothing changes for diagrams you already have: existing gateways (nginx, HAProxy, Load Balancer, Firewall / WAF) behave
as before. A file whose connection has a `deny` that isn't true or false opens with it read as deny, and says so: a
firewall rule never quietly turns into Allow.

## Live explains itself (2026-10)

From the owner's own diagram (docs/DESIGN-REVIEW.md, round 30). Habit changes:

- **A topic or stream nobody reads says so.** Live view no longer calls it "can't keep up at all", "No capacity · 2/s
  waiting" or lag: the banner says **Nobody reads Kafka Topic** with one action, **Add a consumer**, the badge
  **Nobody reads this yet · 297 kept**, and the heat map paints it amber, not red. A queue nobody reads still shows its
  messages **queued** and **waiting**. Paused and down keep their own words.
- **Changing a node's stencil changes its connections' relationships too**, in the same undo step: a flow into a node
  that becomes App Configuration turns **Config** and stops carrying requests in Live; a toast says what changed, with
  **Undo**. One you chose yourself (Relationship ▸, Make it a flow) never changes by itself. Agents' `update` with a new
  `kind` does the same and lists the connections in its result.
- **Partitions say what they do**, under the field: how many consumers in one group work in parallel; they don't speed
  up publishing. Raised in the Inputs panel where they can't help, a line says why.
- **Config and Secret connections say why nothing flows over them**: read at startup and refreshed, not on every
  request. Secret's menu hint is "Secrets it loads, then refreshes" (it was "Secrets it resolves, usually once").
- **A live hover card is never covered** by the node under it (its ring or capacity chip showed through).
- Slow motion says "1,240 waiting" for a service's backlog (it said "lag"), and the trace card's status is **Kept** for a
  message a topic nobody reads keeps.
- Saved files may carry `relationOrigin` on an edge (`inferred` or `explicit`): older builds keep it and ignore it.

## Full screen while presenting (2026-10)

- **Presenting has a full-screen button**, beside **Exit presentation** (the corners icon), and **F** does the same.
  The whole page goes full screen, so live view, slow motion, the trace and toasts keep working as they were. **F** or
  **Esc** comes back; leaving with the browser's own Esc or F11 updates the button.
- **Esc while full screen leaves full screen only.** The next Esc leaves the presentation, as before. Leaving the
  presentation any other way (Exit presentation, Back) leaves full screen too.
- Where the browser can't go full screen (iOS Safari, a page framed without `allow="fullscreen"`) there's no button.
  Embeds and the Interactive HTML viewer have no presentation, so no full screen either.
- **Exit presentation is easier to read** at rest (it was faint, below the contrast it needs), as is the new button.
- The **Present** button's tooltip no longer says "full screen": presenting hides the editing chrome; full screen is
  the new button.

## Share…: every way out, safest first (2026-10)

The File menu's link rows are one row, **Share…** (docs/DESIGN-REVIEW.md, round 27). Habit changes:

- **Copy share link, Copy link with password… and Embed code… are gone from the File menu and the right-click's
  Export ▸.** In their place, **Share…** opens a list of every way out, each saying who can open what it makes:
  **Interactive HTML…**, **Diagram file**, **Embed in your app…** and **Link with password…** first, with the keyboard
  on Interactive HTML.
- **A public link takes one more step.** Share link… and Embed on a public page… are folded under **Public link or
  embed · anyone with the link can open it**, last, and Share… opens folded every time. Share link… opens the Share
  link dialog, where **Copy link** copies it (the toast says anyone with the link can open the diagram). There's no
  one-click copy any more.
- **Ctrl+K**: "Export › Share…", found by "share", "link", "password" or "embed".
- **The password link's dialog is titled Link with password**, as its row is.
- **Embed code opens on one kind**: Embed in your app shows only the private embed your app supplies; Embed on a
  public page shows In the link (and Example by name for an unedited public example).
- **A Private diagram's Share…** lists the two files and Embed in your app, with one line saying why links are off and
  **Make it not private…**. A company's copy without share links lists those three and nothing else.
- **Exporting the diagram file says who can open it** in its toast.

New:

- **The first Import report of an infrastructure file** (docker-compose, Kubernetes, AsyncAPI, Terraform) offers **New
  diagrams are private**, unticked, under Make it private. It asks once; Clear everything on this device asks again. It
  never turns on by itself.
- The agent skill and `llms.txt` point to **File > Share… > Link with password…**.

## Privacy audit (2026-10)

An end-to-end check of everything that could carry a diagram out of the page or keep it longer than you meant
(`docs/PRIVACY-AUDIT.md`). Habit changes:

- **A password-protected Interactive HTML file keeps its neutral title once it's open.** The tab says **Diagram
  (password protected)**, not the diagram's name: browsers keep page titles in their history, and sync it.
- **A private diagram's simulation stays out of the address bar.** Live view still adds `live=1`, but no longer the
  simulation's id (ids can be made from the diagram's words, as a storm's is), so a reload of a private diagram plays
  freely rather than that simulation.
- **Deleting a diagram deletes its AI conversation too** (Undo puts it back), and a shared diagram replaced by another
  link takes its conversation with it.
- **Ctrl+K doesn't remember a private diagram's nodes or simulations** among its recent commands.
- **Copy Mermaid and draw.io on a private diagram** no longer suggest mermaid.live or app.diagrams.net: the toast says
  to keep it where your team controls access.
- **A link embed won't show a diagram marked private** (no app makes such a link; one made by hand or by an older
  copy now says the diagram is private, with no link out).
- **Exported images leave out the Checks card's markers**, which carried the findings' words.
- **Dictation says where your voice goes, every time.** While the browser's speech service listens (not the device),
  a muted line by the mic says "What you say may be sent to Google's speech service." (Microsoft's in Edge, Apple's in
  Safari). It used to say so once per browser.
- **Making a diagram Private offers Clear conversation** when it has an AI conversation (one step, with Undo).
- **Agents told no by a private diagram** hear "Private diagrams are excluded from AI…", not "Local-only…".
- **The Lab (`?view=lab`) is gone from the published site**: it's a development tool, in dev and test builds only.
  The on-device evals run from `pnpm dev`.
- **Embeds write nothing to this browser's storage.** They still read your saved theme; a theme the host page sets
  lasts as long as the embed.
- The agent skill's HTML viewer (plugin 1.1.2) keeps a password-protected file's neutral title once it's open.

New:

- **File ▸ Privacy ▸ Clear everything on this device…** deletes everything Live Diagrams keeps in this browser (every
  diagram, private ones included, edits to examples, AI conversations, file destinations and settings), after one
  confirmation (**Cancel** is the default), then starts over. Other open tabs start over too. Files you saved or
  exported, and cloud copies, stay where they are.
- Opening the File menu no longer warms up Google Drive's scripts while a private diagram is open.
- Embeds' Content-Security-Policy allows this site only: no storage provider's scripts, frames or endpoints.

## Checks: the owner's decisions (2026-10)

Habit changes:

- **Services reading secrets without an identity: the fix now gives each service its own identity** ("Add managed
  identities", one named for each service), so each signs in only to what it reads. The chip under it, **One shared identity**,
  adds one they share, as the button used to. Past 50 services one each is too big for one step: the button adds the
  shared one and the row says why. Agents get the per-service ops in `fix.ops` and the shared one in `fix.others`.
- **Run simulations reports; it doesn't fix.** **Messages are lost at …** no longer offers **Add dead-letter queue**
  (nor does `check_diagram`): it says what was lost, where and how many. The static check **Failed messages are
  dropped** still offers that fix, counts or not.

New:

- **Run simulations from Ctrl+K and the canvas right-click** (after Check diagram), while editing a diagram with saved
  simulations. It opens the Checks card if it's closed, then plays; while they play the same row is **Stop
  simulations**. Never in live view, presenting, embeds, read-only views or exported files.

Unchanged, on purpose: **{client} calls {service} directly** stays quiet when the diagram draws no gateway at all.
Most diagrams that leave it out do so on purpose.

## Run simulations in the Checks card (2026-10)

No habit changes: nothing plays until you ask, and the count under the title is as it was. New:

- **Run simulations**, under the Checks card's summary when the diagram has saved simulations, plays each of them
  without going live (a minute of simulated time each at most) and counts the messages they lose. The counts go under
  the finding they bear out: "30 dropped in “Poison invoices”" under **Failed messages are dropped**.
- Losses no other check explains are a new suggestion, **Messages are lost at …** (with **Add dead-letter queue** at a
  queue or topic), or **Failed requests to … are lost**. It never adds a warning.
- What a simulation loses on purpose (a node it takes down or makes fail, or what its own expectations count on) is a
  muted **On purpose:** line, not a finding: an outage story isn't a design problem. Backlogs and overload aren't
  counted at all; live view's capacity heat map shows them.
- It plays in the background: **Playing 2 of 5: “…”…** says where it is, and typing and dragging don't wait. **Stop**,
  **Esc**, closing the card, going live or an edit stop it at once. Moving or selecting things doesn't.
- The counts are never saved in the file or shared. An edit hides them (**The diagram changed since the simulations
  played. Run again**); Undo brings them back. Private diagrams can run them too: nothing leaves the device.
- Agents: `check_diagram` takes `simulations: true` to do the same (off by default; it takes seconds on a large
  diagram).

## Interactive HTML with a password (2026-10)

No habit changes: the export is as it was unless you turn the new option on. New:

- **Require a password** in **File ▸ Export as ▸ Interactive HTML…** (off by default). The password field is the one
  from Copy link with password… (at least 8 characters, a strength hint, Show), and the dialog then says **Only
  people with the password can open it.** Send the password separately.
- The file is encrypted in your browser with the same crypto as links with a password (AES-256-GCM, the key from
  PBKDF2-SHA-256 at 600,000 iterations). Nothing of the diagram is readable without the password: not its title,
  labels, notes, simulations or banner. It's named **Diagram (password protected)** and a few random letters, so two exports never share a name.
- Opened, it asks for the password, says when it's wrong (try again as often as you like), and plays as before. It
  still works offline and makes no network requests. The password is never stored or sent, and it can't be
  recovered: if it's lost, export again.
- Private diagrams can export it too, as they could without a password. So can a company's own copy with links
  turned off: it's a file.
- It unlocks from disk (checked in Chromium, Firefox and WebKit, Safari's engine) and on `https://` hosts. A plain `http://` intranet host can't
  decrypt it: the prompt says to open the file from disk.
- The Agent Skill's `export-html.mjs` takes `--password`. It never takes the password on the command line: it asks in
  the terminal, or reads `LIVEDIAGRAMS_HTML_PASSWORD`. `export-html.mjs` no longer replaces an existing file: a taken
  name gets the next free one (it says which), and `--force` replaces. The skill offers the password for company content and never
  asks for it in the chat.

## Imports: big ones, replicas, KafkaUser ACLs (2026-10)

One habit change: **a big import draws part of itself.** Past 300 nodes, a Kubernetes, Terraform, AsyncAPI or compose
import with two or more boundaries draws the boundaries with the most flows, and the toast says so ("300 of 1,240
nodes"). **Details** lists every boundary (and what's in none) with its nodes and flows, the drawn ones ticked;
tick others and **Draw these** opens them as a new diagram named by what it draws (the first stays as it is). An
import over 5,000 nodes, which used to fail, now opens this way when it has boundaries. **Draw everything** still
draws every resource, up to 5,000. Also:

- **Replicas.** A Deployment's `replicas: 1` (or compose's `deploy.replicas: 1`) is now written to the node, so the
  "Every request goes through one …" check sees an imported single replica on the only way in. A count the file
  leaves out stays unset, as before; under an HPA or KEDA, only the autoscaler's own minimum counts.
- **Strimzi KafkaUser ACLs.** A workload that uses a KafkaUser's Secret gets that user's topic ACLs as flows: Write
  produces, Read consumes (in its group ACL's consumer group). A deny ACL always wins: a flow it forbids is never
  drawn. Prefix, wildcard and host-limited ACLs are listed in the report.
- **Terraform.** Long module addresses in the report wrap between their parts and can be selected and copied whole.
  **Draw everything** is compact: helpers pack in a grid instead of spreading the first column down the page. A
  Function App that reads Key Vault through its own managed identity says "managed identity" on that connection.

## Checks: secrets and schemas (2026-10)

No habit changes: the count under the title still shows warnings only. Two more checks, in the **Checks card**:

- **{n} services read secrets without an identity** (a suggestion, once per diagram): services with a Secret
  dependency on Key Vault, Secrets Manager, Secret Manager or Vault, and no Identity dependency. The fix, **Add a
  managed identity** (an IAM role on AWS, a service account on Google Cloud), adds one identity and connects each
  service to it; **One for each service** gives each its own. It stays quiet where the diagram already says how they
  sign in ("managed identity" on the vault, say), and for Vault read by services on no cloud.
- **Avro on {topic}, but no schema registry** (a warning): a Kafka topic whose content type or label says Avro or
  Protobuf, in a diagram with no schema registry. **Add Schema Registry** adds one with a Depends on from each producer
  and consumer. AsyncAPI imports already add the registry, so they're flagged only if it's taken out.
- Both fixes only add: dependencies carry no traffic, so the simulation plays exactly as before.
- Agents' `edit_diagram` can now draw a dependency: `connect` takes an optional `relation` (`secret`, `identity`,
  `config`, `telemetry`, `deploy`, `depends`). Without it, a connection is a flow, as before.

## Ids: one per element, so edits never hit the wrong thing (2026-10)

No habit changes. A fix for files that give two elements one id, usually a node and a connection (hand- or
agent-written files, some imports):

- **Opening such a file renames the later one** ("billing-db" becomes "billing-db-2"; nodes keep theirs), and the
  import toast says so. Nothing is dropped: two nodes, two boundaries or a note with a node's id used to stop the
  file opening or lose the second one; both are kept now. A boundary's members follow it, and an ignored finding
  stays ignored for each.
- **Edits act on the kind they name.** Removing or updating a connection through the AI panel, an agent
  (`edit_diagram`) or a Checks fix never removes or changes a node, and new nodes, connections, boundaries and notes
  never take an id something else has (pasting and duplicating too).
- **Checks offer their fixes again** on those connections: they were held back while an id could name a node too.

## Checks: four more (2026-10)

No habit changes: the count under the title still shows warnings only, and a diagram that was clean before stays
clean unless it has one of these. New, in the **Checks card**:

- **{n} requests deep** (a warning): requests that go from service to service four or more times in a row. Each one
  must be up for the first to answer. The fix makes the last call a message.
- **{service} uses {owner}'s database** (a warning): a service reaching into a database that a boundary's own service
  uses. The fix, **Ask {owner} instead**, replaces that connection with a request to the owner, label kept. When
  several services in the boundary share the database, it's a suggestion, with no fix.
- **{client} calls {service} directly** (a suggestion): an outside client going around the way in the diagram draws
  (a gateway or load balancer the other clients use). The fix goes through it; chips under the button add a new
  gateway instead (API Management or Front Door on Azure, API Gateway on AWS, Cloud Load Balancing on Google Cloud,
  else a firewall or Kong). Each is offered only when it keeps every connection's traffic as it was; when the direct
  connections carry settings (a filter, a message type, timing), the row says so and has no fix. Diagrams that leave
  ingress out entirely aren't flagged.
- **Every request goes through one {node}**: a service or gateway you run with one replica that is the only way
  through for an entry point. A suggestion when the diagram says `replicas: 1`; a warning when it's 80% busy or more
  at the diagram's own rates. The fix sets replicas. A replica count you never set isn't read as one (unless it's
  busy).
- Agents' `check_diagram` reports them too, with their fixes as edit operations.

## Sharing says who can open it (2026-10)

Two small habit changes:

- In the File menu, the arrow keys now **stop on rows that are off** (a Private diagram's link rows), so the keyboard
  and screen readers hear why they're off. Enter on one does nothing.
- When a link is refused for a Private diagram, the message's button is **Interactive HTML…** (it used to export the
  diagram file).

New:

- **Every way a diagram leaves the app says who can open it**: Copy share link ("Anyone with the link can open it",
  in the menu and its toast), Copy link with password… ("Only people with the password can open it"), and **Embed
  code… ▸ In the link** ("Anyone who can see the page can open this diagram"). Interactive HTML and the private embed
  already did.
- A Private diagram's off rows, the Privacy submenu and the Private dialog name the way to share it: **Interactive
  HTML** (or the diagram file). The reason under an off row stays readable in both themes.
- The Embed dialog is titled **Embed code**, like its menu row, and Esc closes the Share link and Embed dialogs as soon
  as they open. In the embed preview, Esc goes back to the dialog (the next Esc closes it).
- A password link whose password is still being checked never opens over a diagram you moved to meanwhile.
- The Agent Skill mentions **File > Copy link with password…** for a link only some people can open.

## Import Terraform plans and state (2026-10)

No habit changes. New:

- **Open…**, a drop and **Paste text** read the JSON from **`terraform show -json`**, a plan or a state, several files
  at once. Queues, topics, functions, databases, secrets and identities on AWS, Azure and Google Cloud get their
  stencils; modules (or Azure resource groups) become boundaries.
- Subscriptions, event-source mappings, EventBridge targets, Service Bus and Event Grid subscriptions and Pub/Sub
  subscriptions become **message flows**, so SNS → SQS → Lambda reads as it runs. References between resources
  become **Identity**, **Secret**, **Config** or **Depends on**, and IAM policies and Azure role assignments say who
  reads which secret and who sends or receives.
- The Import report lists what wasn't drawn by type (policies, networking, helpers), the plan's changes, and
  **Draw everything**, which opens the same files with every resource as a node.
- Sensitive values, variables and outputs are never read. A `.tf` file says to run `terraform show -json plan.out`
  and import that.

## Private embeds: your app supplies the diagram (2026-10)

Nothing you do today changes: embed codes made before work as they did. New:

- **Embed code…** has a third source, **Your app supplies it (private)**. Your page loads a small script from
  livediagrams.dev and fetches the diagram from your own server, behind your own sign-in, then hands it to the
  viewer. The diagram never leaves your app: it isn't in any URL and never reaches livediagrams.dev, which only
  provides the viewer.
- Two ways in, both copied from the dialog: the `<live-diagram>` web component
  (`<live-diagram src-json="/diagrams/orders.diagram.json" simulation="black-friday" autoplay>`), or a plain iframe
  with a few lines of `postMessage`. **Diagram file** in the dialog saves the file to serve.
- Your page can drive it (play, pause, speed, simulation, fit, theme, highlight nodes, load another diagram) and hear
  from it (node clicks, play state, the height that fits the diagram). The reference is `docs/EMBEDDING.md`.
- **Private diagrams can now be embedded this way.** Embed code… used to be off for them; it now opens with only
  this source, since nothing of the diagram goes in the code. Share links and link embeds stay off for them.

## Agent Skill: asks what you want back, and makes Interactive HTML (2026-10)

One habit changes for people who use the livediagrams Agent Skill: it **asks which output you want** before it hands
the diagram back, unless you already said. Update the plugin in Claude Code (`/plugin`), or download the skill again
for the Claude apps and Codex.

- **Interactive HTML file**, offered first and recommended for anything about your work or company: the same file as
  **File ▸ Export as ▸ Interactive HTML…**, made on your computer by the skill (`scripts/export-html.mjs`). It plays
  the simulations, works offline and makes no network requests, and only people who have the file can open it. Ask
  for a banner such as "Confidential".
- **Diagram file** (`.diagram.json`) to keep editing, **Image** (the skill says how to export one from the app) and
  **Share link**, which the skill now says anyone who has it can open. A private diagram never gets a link.
- For work diagrams the skill marks the diagram private (`"private": true`).

## Import Kubernetes manifests (2026-10)

No habit changes. New:

- **Open…**, a drop and **Paste text** read **Kubernetes** manifests, several files and documents at once
  (`kubectl get … -o yaml` or `-o json` too). Namespaces become boundaries, workloads get stencils from their
  images, Services lead to the workloads they select, and an Ingress, a Gateway or a LoadBalancer Service is the
  entry from Users.
- ConfigMaps and Secrets become **Config** and **Secret** relationships named by their keys. A Secret's values are
  never read. Workload identity (Azure, AWS IRSA, GKE) becomes an **Identity** relationship.
- Connections come from settings as in docker-compose, and from **KEDA** triggers (Kafka, RabbitMQ, SQS, Service
  Bus): the topic or queue sends to the workload it scales. **Strimzi** topics join with them on their cluster.
- The Import report lists what wasn't drawn by kind ("ServiceMonitor orders-api: unknown kind") and each scaler's
  replica range. A Helm chart's templates say to run `helm template` and import its output.
- New stencil: **Service Account** (Google Cloud).

## Checks (2026-10)

No habit changes. New:

- **Checks** find likely design problems as you edit: failed messages that are dropped (no dead-letter queue), a topic
  or queue nobody reads, requests that go round in a circle, and a service that can't keep up at the diagram's own
  rates. When there's a warning, a muted **⚠ 1 warning** appears under the diagram's title; suggestions alone show
  nothing.
- **Check diagram** (that count, the canvas right-click, Ctrl+K or View ▸ Checks) opens the **Checks card**. Each
  finding names what it involves (click to select it), says why it matters, and offers a fix ("Add dead-letter
  queue") as one undo step. **⋯ ▸ Ignore here** (with an optional reason) and **Turn off this check** are kept in the
  file, so whoever opens it sees the same; the card's foot brings them back.
- While the card is open, small markers show on the nodes and connections it names. Select one and its finding is at
  the top of the inspector.
- Checks run in the background after you pause, so typing and dragging don't wait. Live view and presenting show no
  count; private diagrams are checked like any other, on this device.

## Interactive HTML export (2026-10)

Nothing you do today changes. New:

- **File ▸ Export as ▸ Interactive HTML…** (also the canvas right-click's Export ▸ and Ctrl+K) downloads one
  `.html` file with the diagram and its simulations. Open it in any browser, or put it where your team already
  controls access (SharePoint, Confluence, an internal site, a repository): no public link, no account, no internet.
- In the file, people pan, zoom and play the simulations (pick one, pause, change the speed, trace a message, slow
  motion). They can't edit it, and it opens nothing else: it makes no network requests and saves nothing in the
  browser.
- **Options** sets the title, a banner across the top (say "Confidential: internal use only"), light or dark, which
  simulations go in and which one plays when the file opens.
- Private diagrams can be exported this way too, like saving them to this device. Anyone who has the file can open
  it, and the dialog says so.

## Import AsyncAPI documents (2026-10)

No habit changes. New:

- **Open…**, a drop and **Paste text** read **AsyncAPI** 2.x and 3.x documents. Open several at once and they join
  into one system on their channels: a producer in one file and a consumer in another become one flow. Servers
  become boundaries, channels get their broker's stencil (Kafka, RabbitMQ, Service Bus, SNS, SQS, Pub/Sub, MQTT…),
  and edges carry the message types.
- Each import saves an **Imported traffic** simulation: Go live and pick it to watch the messages flow. The Import
  report says where the traffic starts and how fast.
- References (`$ref`) are followed inside the files you open; a remote one is never fetched, and the report lists it.
- New stencil: **MQTT Broker** (also for Mosquitto, EMQX and HiveMQ in docker-compose files).

## Import docker-compose files (2026-10)

One habit changes: **Open…** and a drop take several files at once. Opening one file works as before. New:

- **Open…**, a drop and **Import from ▸ Paste text…** read a **docker-compose** file. Drop it with its
  `docker-compose.override.yml` (and a `.env` file it names) to merge them the way Compose does. Each import
  makes a new diagram in Your diagrams: services on their stencils (PostgreSQL, Kafka, NGINX…), the networks
  as boundaries, and connections found in the files, including settings such as `DATABASE_URL` or `INPUT_TOPIC`.
- The toast's **Details** opens the **Import report**: which stencils are guesses (one click picks another),
  which setting each connection came from, and what wasn't drawn or couldn't be read, and why. Ctrl+K "Import
  report" opens it again while the diagram is open.
- Everything is read on this device. Setting values are used only to find host names and are never kept. With
  **New diagrams are private** on, the import is private; otherwise the report offers **Make it private**.
- Kubernetes manifests, AsyncAPI documents and Terraform plans are recognised, and say they can't be imported
  yet.
- New stencil: **MySQL** (MariaDB too).

## UX review, round 13 (2026-10)

Two habits change:

- **Double-click quick-add opens the new node's name.** Pick a stencil and type: the words name the node, as after
  Alt+arrow, the "+" and a dropped connection. They used to reach the canvas, where a T added a text and an L went
  live. One Ctrl+Z takes the node, its connection and their names, however long you take to type them (also after
  Alt+arrow, the "+", a dropped connection, or a rail or Ctrl+K add named with Enter straight after).
- **Shift+drag on empty canvas adds to the selection**, as Shift+click does. A plain drag still replaces it.

Also:

- An Undo toast ("Payments service left AKS · Undo") goes as soon as Ctrl+Z or the canvas's Undo runs, since its
  button would then reverse a different change.
- Esc clears the selection and keeps keyboard focus on the node, so Tab carries on from there; Esc never selects.
- Ctrl+K finds **Present**. Presenting puts keyboard focus on the canvas.
- In the AI panel, Advanced and the on-device box no longer squeeze the conversation: past 60% of the panel, they
  scroll.
- The shortcuts sheet lists the File keys (Ctrl+O, Ctrl+S, Ctrl+Shift+S) and slow motion's ← →.

## Private diagrams (2026-10)

No habit changes unless you use it. New:

- **File ▸ Privacy ▸ Private diagram** keeps a diagram on this device: no share links or embed codes, no saves to
  Google Drive, OneDrive or Dropbox, and no AI (the page's tools, Copy for AI and copied prompts are off). A
  **Private** lock sits beside its title; click it to read what that means or to make it not private again.
  Saving and exporting to this device work as before, and an exported file stays private when it's opened again.
- **File ▸ Privacy ▸ New diagrams are private** makes everything you start, import or open from this device
  private.
- In a private diagram the AI panel can allow Chrome's on-device model, which runs on this device.

## Structure and bulk (2026-10)

Three habits change:

- **Boundaries keep up.** A node belongs to the boundary around its centre, as before, but you now see it while you
  drag: the boundary it will be in lights up, and one it's leaving shows dashed. Drop a member so it pokes out of
  its boundary and the boundary grows to hold it; it used to stay the same size, and a node dragged a little too
  far quietly left. Leaving now says so, with Undo. Resizing a boundary takes in the nodes now inside it and lets
  go of those outside. Boundaries never shrink by themselves: Fit to contents does that.
- **Tab moves between nodes.** The canvas is one stop in the page's Tab order. Inside it, Tab and Shift+Tab step
  through the nodes in reading order, selecting each one; past the last, Tab leaves the canvas. Tab used to visit
  every node and then every edge, in the order they were made. Edges are reached from a node with Ctrl+Alt+] and
  Ctrl+Alt+[, and Ctrl+Alt+arrows (⌃⌥ on a Mac) go to the nearest node that way.
- **Route from side and Route to side are one row**, Route ▸, on the edge's menu.

Also new:

- With several things selected, the inspector edits them together: the nodes' stencil, boundary and shared
  simulation settings, the edges' relationship and label, and the colour of annotations and boundaries. "Mixed"
  shows where they differ. Each change is one undo step.
- Select similar (a node's or an edge's right-click, Ctrl+K) selects every node of that stencil, or every edge of
  that relationship.
- Tidy up (a selection's right-click, the inspector, Ctrl+K) lays out just the selected nodes by their connections,
  without moving anything else. Align and Distribute no longer stack nodes on top of each other.

## Flow building (2026-10)

One habit changes:

- **A rail click respects the selection.** With exactly one node selected, clicking a stencil in the rail adds
  it after that node, connected, as Ctrl+K's "Add …" already did. The rail's footer says so ("A click adds
  after Payments service"). With nothing selected, or several things, it adds an unconnected node in free
  space, as before. Drag the stencil instead to place it anywhere.

Also new:

- A selected node shows a "+": click it to pick the next node, which lands beside it, connected and ready to
  name. Alt+arrow does the same from the keyboard (→ and ↓ downstream, ← and ↑ upstream), and Alt+Shift+arrow
  adds a copy of the node there. On the canvas, Alt+← and Alt+→ no longer go back or forward in the browser.
- A new connected node's name editor has one more field: Tab, Tab names its connection.
- Drag either end of a selected edge onto another node to rewire it; it keeps its label and settings. From the
  keyboard, the edge's menu and Ctrl+K have Reconnect ▸ From / To.
- Hold a new node (or a stencil from the rail) over an edge for a moment and drop it to put it in between, or
  use Insert node on the edge's menu or in Ctrl+K.
- Dragging a stencil shows the node card it makes and an outline where it will land.
- Quick-add finds stencils the way the rail does: "pg" finds PostgreSQL, "go" the Go service.

## Drawing precision (2026-10)

Two habits change:

- **Esc saves a label instead of cancelling it.** In a node's label editor Esc used to throw the edit away; now
  it keeps it, as it already did for text and notes, and as Figma and tldraw do. Every text box on the canvas
  works the same way: Enter or Esc saves, Tab goes to the next field (label, then subtitle). Changed your mind?
  Ctrl+Z (⌘Z on a Mac) right after takes the edit back.
- **Snap to grid is now Snapping, and the arrow keys stay on the grid.** Dragged nodes line up with their
  neighbours' edges and centres, and with equal gaps, as well as with the grid. Hold Ctrl (⌘ on a Mac) while
  dragging to place something freely. An arrow key moves the selection to the next 10 px grid line and
  Shift+arrow moves it 50 px; they used to move 1 px and 10 px, which they still do with Snapping turned off
  (Show ▸ Snapping).

Also new:

- Enter edits the selected node, edge, boundary or annotation (F2 still works).
- Label editors stay readable when you're zoomed out.
- Ctrl+K opens at once, and what you type straight after it goes into its search.

## Drawing basics (2026-10)

Two habits change, to work like Figma, tldraw, Excalidraw and draw.io:

- **The wheel pans; Ctrl/⌘+wheel zooms.** A two-finger swipe moves the canvas in both directions, a pinch
  zooms, and Shift+wheel pans sideways on a mouse. Mouse users who zoomed with the wheel now hold Ctrl (⌘ on a
  Mac). Space+drag and the middle button pan from anywhere, even starting on a node.
- **A drag on empty canvas draws a selection box** (it picks what it touches; hold Ctrl/⌘ for only what's
  inside). Shift+click now adds to the selection, like Ctrl/⌘+click. Live view, presentation and embeds still
  pan with a drag, and an embed still lets the wheel scroll its page.

Also new:

- Drop a connection on empty canvas to pick the next node: it lands there, connected, ready to name.
- A connection dropped anywhere on a node connects to it; the node lights up first, and handles are easy to
  hit at any zoom.
- Ctrl+D, Ctrl+V and Alt+drag never put a copy on top of anything. Ctrl+V pastes at the pointer.
- Shift+2 zooms to the selection (also in Ctrl+K).
