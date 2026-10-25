## Trace and slow motion load when requested

Live's first frame no longer downloads journey construction or the trace/slow-motion
runtime. Candidate A uses one registered React runtime adapter with `export: "await"`.
Both journey consumers move with it. Free play, initial badges, node/edge readouts and
the ordinary timeline keep working while its request is held.

The shell retains a stable command/subscription facade, cancellation and Retry. A replay
request flushes pending configuration and synchronously pauses and holds Live at the
requested checkpoint, saving its playing state and viewport. Until handoff the latest
request wins; replacement preserves that original checkpoint. Downloading takes no
camera ownership. A failed download keeps the command and hold for one Retry or Escape.
Escape, leaving Live and a generation change retire the pending command. A higher
priority modal queues handoff, including before its DOM mounts. Output dialogs consume
the requested replay: image export and recording also await capture completion. Model
exports remain available. The loaded replay keeps its existing invalidation and camera
restoration behavior.

Replay keys cannot continue Live narration or edit the drawing. Focused buttons retain
their native activation, including keyboard Retry. Failure notices disappear with their
last consumer. Trace-only loading uses the existing bar notice; replay loading uses the
existing slow-motion status. No control or chrome was added.

## Size measurements

Windows, Node 24.22.0, pnpm 12.11.2, level-9 gzip, deployment defaults without E2E.
The source baseline is merge base `cba603eb01974dd617e84c5032a37447eb5b96e9`.
Both builds set `VERCEL_GIT_COMMIT_SHA=5266d8b4fa12833a2f6cfe72a15c565a85c55da8`
to hold build metadata fixed. Browser measurements use
`BENCH_BASELINE_ONLY=1 node scripts/bench/bundle.mjs --mode quick`; viewer/Forge use the
same build scripts as `pnpm size`. The baseline is an unmodified tracked-source archive
inside this checkout's ignored output directory, with the installed dependencies reused.
Delivery sets overlap and must not be added together. All budgets and the ZIP cap stay fixed.

| Entry / delivery set           | Before gzip B | After gzip B |    Delta B |  Budget B | After headroom B |
| ------------------------------ | ------------: | -----------: | ---------: | --------: | ---------------: |
| Main entry                     |       108,090 |      108,108 |        +18 |   123,500 |           15,392 |
| Startup closure                |       159,366 |      159,384 |        +18 |   177,000 |           17,616 |
| Canvas first view              |       364,382 |      364,546 |       +164 |   383,000 |           18,454 |
| Live additional                |       130,927 |      126,086 | **-4,841** |   135,000 |        **8,914** |
| Standalone viewer JS/CSS/fonts |       610,852 |      612,879 |     +2,027 |   805,000 |          192,121 |
| Forge resources                |       895,902 |      897,925 |     +2,023 | 1,020,000 |          122,075 |

All JavaScript is 3,104,790 B gzip across 271 files, versus 3,101,097 B across 269.
Deferral adds compressed delivery overhead while reducing the Live entry. The facade
and runtime readiness hook account for retained code. Forge raw resources are 2,591,632 B
against the unchanged 5,000,000 B limit. The skill ZIP is **818,045 B** against its unchanged
835,000 B cap.

The rebase includes master's independent viewer trim (#336). It frees enough ZIP space
for the same registered runtime to serve the website and the self-contained HTML viewer;
a separate eager viewer adapter was rejected as unnecessary. The final before/after table
uses that master revision for both sides, so its savings are not attributed to this trim.

## Verification and deliberate regressions

Held production-chunk tests cover Free play interaction; node and edge hover/keyboard
pinning; timeline seeking; next/slowest/dead-letter tracing; node/card/palette replay;
Escape, simulation switching, exit/re-entry and stale completion; failure and keyboard
Retry; pending modal ownership; checkpoint/play-state/camera restoration; image/model
export and recording readiness. The replay matrix covers worker/main renderers, reduced
motion and paused/live starts. Both renderers' video tests capture captions after a held
runtime download.

Restoring a static runtime import fails the production held-chunk test and the build's
static-closure assertion (adapter, replay execution and journey all leak into Live).
No golden is intentionally changed or re-recorded: this is a delivery refactor.

Rejected: the slow-motion-only split cannot reliably meet the headroom floor; journey
construction must move too. Hook calls after asynchronous imports and temporary no-op
command refs would violate React lifecycle and lose user intent. Eager runtime prefetch
would defeat the intent boundary. Extra loading controls would spend chrome without
adding capability.

## Verification results

Full parity checked 3,178 goldens with zero changed, added, missing or stale records.
A final browser-tier pass checked 133 goldens unchanged (110 browser tests). No golden
was re-recorded. The final shared-runtime regression run passed 15 production browser
tests, including the eight renderer/motion/start combinations, offline HTML replay,
keyboard Send one now, image/model export and recording readiness. Focused unit, skill
and viewer-build checks passed 231 tests. The production build, entry/viewer/Forge budgets,
i18n check and regenerated skill assets pass.

The one broad native unit run was not green: 12,872 passed, seven failed, ten expected
failures and 172 skipped. The initial ZIP overage was fixed; two HTML cases raced a viewer
regeneration and pass after generation settled. Four five-second harness timeouts (planning,
example evidence and two dependency-install fixtures) pass their targeted reruns without
changing assertions or timeouts. The final full skill file passes all 166 cases. See the
[contention follow-up](../backlog/2026-10-25-heavy-unit-contention.md). The initial 115-test
browser run had two integration failures; both were fixed and pass targeted regressions.
Linux repetitions with camera/inspector neighbours were attempted but exited 75 because
the shared worker budget was busy; no capacity lock was bypassed or removed.
