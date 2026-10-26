## Diagram details review

The diagram title appears once in the bezel. Description, privacy and reset belong in unselected Properties. The checks link appears only while checks are available. Empty-state and first-run guidance retain their canvas positions. The independent designer review found no remaining desktop layout blocker after the disabled-checks and variable-height callout fixes.

The public checkout screenshot is an Overview fit. Focus camera tuning and the phone bottom sheet belong to steps 10–11. Six real production screenshots (empty, editing, inspector in light and dark) are saved under the requested build/part1 destination. Inspector captures wait for lazy content to finish.

## Preserved targets and changed flows

Diagram-title stays on the picker, diagram-description moves into Properties, and checks-count stays on the rail. The removed app diagram-card has no replacement overlay. Presentation/viewer cards are retained. openDiagramProperties uses the stable context-menu action id, so callers work in translated chrome too.

Description/security tests and privacy-badge readers now open Diagram properties first. Chrome, capacity, checks, fit-settled, layout, showcase-examples and sim-truth tests audit the new surfaces. The folded-card cache regression runs on the retained presentation card. The pending-fit cancellation regression adds an explicit test overlay to the pane. The layout audit includes the bezel, rail and dock along with remaining canvas overlays. Phone title tests check intentional ellipsis and keep control bounds/focus checks.

The AI history test uses bezel Undo after switching to the AI tab: the switch took focus from the canvas. It still proves that the later move is reversed separately from the earlier AI turn. No assertion, timeout or skip was relaxed.

The moved Live switch also preserves aria-busy and the progress cursor while the session chunk is held. Its readiness comes from the existing session host, keeping tutorial waits and loading semantics intact.

Annotation instructions now name Annotate → Text/Note/Zone in all 37 locales. The direct annotation test opens that flyout. A command-palette regression counts graph wrappers instead of also counting an incidental node tooltip; it explicitly requires three nodes before preserving the count across Skip. The active Tutorials check reads aria-pressed on its new rail button, preserving the active-view assertion with the correct button semantics instead of adding invalid tab attributes.

## Build boundaries

The eager dock reuses lib/machine.ts. Production network inspection showed a new preloaded machine chunk; the exact startup-chunk assertion now includes that helper. All 26 bundle-split checks pass, including the exclusions for React Flow, planning, AI, simulation and inspector implementations. Budgets remain unchanged.

## Sequencing decisions

The earlier additive token step leaves the existing stage/accent values for the later visual/output commit. New note/tag/dim-stroke amendments are included. Live transport selectors and bottom clearance remain until step 6 moves that surface outside the pane. The 60px status reserve is a minimum while the old floating callout still exists; its measured bottom prevents wrapped content being covered.

## Verification

Fresh targeted camera, dock, settings and token checks: 1,368 passed. Removing edge-label bounds temporarily made its regression fail; restoring them passed. Ignoring the system theme preference temporarily made its regression fail. The broader quick unit selection ran 13,721 passing tests, including all 1,862 completion-sweep cases and all 500 tutorial catalog cases, with four then-failing assertions that were subsequently fixed and passed targeted checks. Earlier baseline tutorial timeout evidence remains in its separate backlog fragment.

Production build, size, regeneration and i18n checks pass. Step-4 entry gzip9 was 110,106 B (+1,988 B from 108,118 B); the final entry remains about 110.1 KB, comfortably above 8 KB headroom. Step-2/3 Vite gzip readings were 110.24/110.55 KB (default compression, not the level-9 budget measurement); step 4 was 111.25 KB by that same Vite reading. Individual level-9 deltas for steps 2–3 were not retained. Final entry after sync: 110,124 B (+18 B from the recorded step-4 build; +2,006 B from baseline), with 13,376 B headroom. The generated skill ZIP is 820,415 B below its unchanged 835,000 B cap.

The first final quick invocation accidentally used a short filter matching this worktree's path and selected all browser specs. It was stopped before running that suite; subsequent runs use explicit spec paths. Shared-budget exit-75 attempts prevented the Linux five-repeat neighbour run. Browser gate results and any remaining limitations are reported with the pushed commit.

## Final regression evidence

The explicit 213-case browser selection passed 203, failed nine and retained one existing skip. All nine failures were corrected and passed a fresh ten-case selection that also checks a held Live session's cursor, focus and file export. The unchanged successful cases were not rerun. After the annotation copy change, all 500 catalog cases and 21 annotation completion cases passed (the remaining completion cases were filtered, not skipped in source).

A subsequent nine-case Workbench smoke attempt timed out while starting servers, with zero browser cases executed. The final report distinguishes this infrastructure failure from the successful regression selection and records the final smoke gate result. Linux neighbour repeats were not admitted (exit 75). The earlier broad invocation's short path filter was corrected to explicit file paths; no full local gate was run.

The final nine Workbench smoke cases passed with the shared-budget Playwright runner, against the production E2E bundle. The ten targeted regressions and nine smoke cases are separate passing selections. Two quick-gate smoke attempts timed out on cold server startup before executing tests; neither is reported as a passing gate. Final gate SUMMARY: 599eddee7349bcd952697aeb663a67cc68b9c56e | unit="not run" parity="not run" e2e={"passed":0,"failed":0,"flaky":0,"skipped":0} gate_failures=1.

## Master sync

Before the final push, pnpm sync rebased the five signed commits onto ba4a48ed4 (engine checkpoint boundary, PR 353) and regenerated the viewer. The post-sync camera, dock, settings and token selection passed all 1,368 cases; the build, size and skill freshness checks passed. The screenshots were retaken from that production build. Historical gate SUMMARY heads above describe the runs at the time they were made.
