## Scope and revision evidence

Nightly [40813604106](https://github.com/latchkostov/diagrams/actions/runs/40813604106)
ran `1f53b4779afbef4143175eb0f0aa10fd654d50b2`, parent `9798327fa`, rather than
master's #390 revision `31d4b40c8`. Its inline catalog matcher predates the shared
`scripts/e2e-catalog.ts` and its regression tests. The fourteen Dev pending/failed
locale errors are still `asked === false` or missing Retry feedback. The trace
records requests to `de-core` and its surface buckets; #390 already matches them.
Do not describe passing checks of that fix as another locale application repair.

Logs were downloaded with `gh api --allow-escape-sequences .../jobs/<id>/logs`;
failed Dev 1/3/4/6 and Build 3/11 artifacts supplied traces and error snapshots.
Local raw evidence is retained under `tests/.output/nightly-evidence/`.

## Confirmed fixes and negative controls

- AI close/reopen: the close schedules a rail-focus callback on the next frame.
  A reopen can focus the panel first, then lose focus to that old callback. The
  unit regression with the old callback has one failure and one pass; the guarded
  callback passes both close and reopen cases.
- Greek rail: the shipped Mona Sans CSS has Latin subsets, no Greek. Nightly's
  apt log confirms FreeFont, Liberation and WenQuanYi are installed, as in the
  pinned noble image; this is not missing Playwright font installation. The image
  selects WenQuanYi for Greek, while adding DejaVu makes `fc-match system-ui:lang=el`
  select DejaVu Sans. In that environment both unchanged Greek rail tests fail
  with the exact three-line error from Nightly. A standalone real-font probe
  measures three lines at 52 px and two at 56 px. The fix allocates that width
  within the existing buttons. A preliminary dev rerun retained Vite's cached
  old CSS (computed padding 4 px, caption width 52 px); that failure is not a
  successful verification of the fix. Fresh builds are required.
- Tutorial Skip-all: the trace reads `survive-psp-brownout`, clicks Skip, advances
  the fake clock, then reads `never-double-charge`. The old inequality accepts
  that backward transition and stops time. The replay later returns to brownout
  and stalls under a stopped clock. A deterministic fixture revisits its
  predecessor and requires exactly one Skip; the old driver fails, the corrected
  forward-progress predicate passes. No application runner or timeout changes.

## Boundary title lifecycle

The boundary drag is now a confirmed fourth fix. Native Dev reproduced the exact
Nightly `gesture`/`idle` failure twice, with 308 other cases passing. Trace snapshots
show `data-detail-view` missing while the label is measured, then restored with
decoration during the press. StrictMode's effect cleanup deletes CanvasView's
declarative attribute; the next setup previously waited for fonts before restoring
it. A pending-font StrictMode unit test fails with the old effect (one failed,
four passed) and passes with synchronous setup restoration. It also checks that
image capture still removes the attribute. All thirteen frame/capture units pass.

## Greek font diagnostics

Linux browser jobs now print `fc-match` for Greek system-ui/sans-serif and list
Greek-capable families after provisioning dependencies. The dispatched Nightly
can establish the runner's actual selection; reproducing with DejaVu alone does
not prove which system font the original runner selected.

Chromium's `CSS.getPlatformFontsForNode` confirms that the controlled container
renders the caption's Greek glyphs with DejaVu Sans Bold. The fresh application
reports padding `4px 2px`, caption width 56 px, font size 12 px and two glyph lines.

## Singles requiring further evidence

These are unresolved, not declared fixed by an isolated passing replay. Preserve
the exact assertions and obtain a failing controlled reproduction before changing
the application or broadening test readiness.

| Case                                                   | Nightly error and retained evidence                                                                                                                                                                                                                                  | Next discriminating check                                                                                                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev Arabic Checks, `requests-wait-checks:68`           | [Job 123249703925](https://github.com/latchkostov/diagrams/actions/runs/40813604106/job/123249703925): primary fix absent. Snapshot shows the correct diagram and Checks dock with `Checking…`, no findings yet.                                                     | Hold the current document's worker result and observe readiness before opening its finding. Do not infer completion from a previous warning count.                                                                                  |
| Dev timeline roving stop, `ux-resilience-followup:116` | [Job 123249703980](https://github.com/latchkostov/diagrams/actions/runs/40813604106/job/123249703980): immediate count is zero rather than one. Controls can mount before the separate lazy `Timeline` surface.                                                      | A held-Timeline test with explicit marker readiness passes, but removing the added wait also passed locally. That candidate was discarded rather than claimed as a proven fix. Capture the lazy-surface boundary deterministically. |
| Build job's dev SVG export, `lowzoom-chips:216 @dev`   | [Job 123249703984](https://github.com/latchkostov/diagrams/actions/runs/40813604106/job/123249703984): two of three executions exhaust the existing whole-test timeout in `svgDigest`/`renderDiagramImage`; the test compares six exports from two browser contexts. | Capture export progress/resource readiness under load and distinguish module/font loading from clone work. Keep every SVG digest, the workload and the existing backstop.                                                           |

## Verification

The i18n units, catalog matcher and new AI regression pass: 17 files, 717 tests.
The reserve/build-splitting heavy file passes all 30 tests with unchanged budgets.
The first exploratory Linux browser sweep was stopped after 387 completed passes
to restart with fresh CSS and a controlled font environment. Its checkpoint is
interrupted; it is not reported as a passing two-repeat gate.

Full parity passes: 1,873 Node tests, 110 Linux browser tests, **3,178 goldens,
0 changed, 0 added, 0 missing, 0 stale**. No goldens were updated. Production build,
`pnpm size` and all twelve E2E workflow unit tests pass.

An eight-worker gate admission exited **75 (busy)**. A four-worker focused gate
was admitted. An additional Dev probe initially shared that four-CPU container
with the Build run: AI and editor reached their whole-test timeouts, after the
original AI-focus assertion had already passed. The probe was stopped with ten
passed, two timed out, four interrupted and 294 not run; it is not a passing Dev
repeat or a reproduction of the original assertion signatures. Dev is checked
separately after that load, without changing any backstop.

Final targeted results, parity and dispatched Nightly outcomes are recorded in
the PR and final handoff. No full suite or clean-master full suite is scheduled
for this fix round.

## First targeted Linux Build verification

The named failing declarations, the new tutorial driver regression and the entire
every-language rail spec pass twice on fresh builds in the pinned noble image,
four workers/four CPUs, ports 6530–6534. DejaVu was installed before browser
startup. Each repetition passes 154 Chromium cases and the requested dev-only
SVG-export case: **310 passed, 0 failed, 0 flaky, 0 skipped**. Reports:
`tests/.output/g/rNrotoK`. The gate owns and stops all its servers and container.

The quick gate tested the working changes; its summary identifies the baseline
HEAD before the signed fix commits:

```text
SUMMARY: 31d4b40c826afa44be1f4b4c9c18b47551f5136e | unit="not run" parity="not run" e2e={"passed":310,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Final Dev verification

After the boundary lifecycle fix, the same named declarations and complete rail
spec pass twice against Vite dev on Windows, Node 24.22.0, four workers, ports
6510–6514: **310 passed, 0 failed, 0 flaky, 0 skipped**. The assertions and
backstops are unchanged. Reports: `tests/.output/nightly-evidence/dev-fixed.json`.
Playwright stopped both servers. The four remaining singles passed both times;
their original Nightly causes remain unproven rather than silently marked fixed.

## Dispatched Nightly and inspector naming

[Nightly 40825477973](https://github.com/latchkostov/diagrams/actions/runs/40825477973)
confirms the locale paths and Greek rail labels pass. Its Linux font report selects
DejaVu Sans for both Greek generic families, confirming the real layout overflow.
All eight Dev shards completed: seven pass; Dev 4 reproduces the inspector failure.
The Simulation click remains collapsed at the same coordinates while naming is
active and the planning explanation replaces a shorter row above it.

The inspector driver now completes naming with Enter, waits for planning to leave
its loading state and the button to settle, then clicks. A controlled DOM fixture
moves the button on name blur: the old pointer-only helper fails; the corrected
helper passes. All original concurrency, persistence and two undo assertions remain.
Dev runs both cases twice (four passes); Linux Build runs the whole editor spec twice
(36 passes, zero failed/flaky/skipped). No application disclosure behavior changes.

The Arabic Checks, timeline and dev SVG export cases pass in this dispatch; their
original failure mechanisms remain documented above. Build 11 instead reports an
unrelated quick-add naming failure in `trim3`; master #392 already adds the missing
ready-results signal to that exact test. Sync that upstream fix rather than duplicate it.
