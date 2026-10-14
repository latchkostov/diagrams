# PR #98 review disposition

## Round 3 (2026-10-14)

Review: `.reviews/20261014-131908/REPORT.md` (10 P1, 7 P2). All findings confirmed;
three repeated reports share fixes. No findings rejected. Rebased onto master after #96;
the released plugin is 1.1.12, exactly one patch above master's 1.1.11.

| #   | Priority | Finding                      | Disposition and regression evidence                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P1       | Accessible explanation       | Fixed: hover uses an unlabelled wrapper. The node's computed accessible description includes capacity, demand and observed counters.                                                                                                                                                                                                                                                                                                                                  |
| 2   | P1       | Diagram context              | Fixed: `resolveNodeProps(diagram, node, overrides)` and every live capacity helper require the diagram. Raw resolution requires an explicit revision argument; legacy probes use a named legacy resolver. Sparse active-active F5, Capacity ×2 and Save agree on two units.                                                                                                                                                                                           |
| 3   | P1       | Clipboard validation         | Fixed: whole files go through native validation; fragments share preset compatibility and property bounds. Future revisions, unknown presets and out-of-range concurrency are rejected.                                                                                                                                                                                                                                                                               |
| 4   | P1       | Historical live tweaks       | Fixed: stable engine configuration snapshots drive planning. Publications reconcile overwritten property/status keys, preserving unrelated tweaks and previous immutable publications. Inputs, diagram edits, timeline and seek regressions.                                                                                                                                                                                                                          |
| 5   | P1       | Partial migration            | Fixed: setup and timeline remain authored patches, with only dependent device values pinned. A latency action leaves an Inputs concurrency override at eight through upgrade and downgrade; existing seeded device parity tests still pass.                                                                                                                                                                                                                           |
| 6   | P1       | Geometry cache key           | Fixed: key uses node/connection semantics and effective planning configuration, excluding geometry, annotations and document metadata. Twenty moves reuse the same analysis and sizing result, with unchanged solver call counts.                                                                                                                                                                                                                                     |
| 7   | P1       | Render work bound            | Fixed: preflight caps nodes, edges, nested reads, text, routing/type comparisons and broker flow work before serialization, topology or solving. Oversized graphs show a recovery hint while retaining observed counters; DAG work stops at dependency depth and cycles retain the fixed cap. Operation counts prove zero solver/property reads for huge input, bounded nested reads rejection of dense cycles, and exactly two passes for capped one-hop DAG demand. |
| 8   | P1       | Sparse whole-file playback   | Fixed: source preset values are materialized before revision-free paste. Resolved replicas, capacity and 60 seeded playback steps agree for whole-file and selection paste into legacy documents.                                                                                                                                                                                                                                                                     |
| 9   | P1       | Unsupported presets in paste | Confirmed duplicate of #3. Includes a system-clipboard editor paste regression proving no node/edge mutation.                                                                                                                                                                                                                                                                                                                                                         |
| 10  | P1       | Overwritten tweaks           | Confirmed duplicate of #4. The explanation uses current engine latency and capacity; unrelated failure settings remain saveable.                                                                                                                                                                                                                                                                                                                                      |
| 11  | P2       | Compacted metrics            | Fixed: Properties exposes expandable Live details with throughput, processed/waiting/in-flight, failures, dead letters, drops, blocked traffic and every consumer-group lag. Keyboard browser regression uses a short viewport with 24 groups.                                                                                                                                                                                                                        |
| 12  | P2       | Add-consumer focus           | Fixed: cleanup resolves the surviving Label after selection commits instead of retaining a removed input. Enter activation focuses the new consumer's Label.                                                                                                                                                                                                                                                                                                          |
| 13  | P2       | Inferred group remapping     | Fixed: inferred group origin is tracked separately; a model-level remapper follows consumer IDs. Authored group edits clear inference and retain their names. Copied and newly connected policies share one subscription.                                                                                                                                                                                                                                             |
| 14  | P2       | Connection render complexity | Fixed: a shared node lookup map and memoized connection panel keep live counters separate. A thousand peer rows use bounded ID comparisons; counter publications retain cached rows and analysis.                                                                                                                                                                                                                                                                     |
| 15  | P2       | v2 preset materialization    | Confirmed duplicate of #8. Clipboard uses the shared small preset values, keeping profiles and explanations out of the first canvas bundle.                                                                                                                                                                                                                                                                                                                           |
| 16  | P2       | Screenshot isolation         | Fixed: captures use `testInfo.outputPath()` and report attachments. An automatic fixture rejects screenshot writes outside the individual test output before writing; documentation images are refreshed only by explicitly copying reviewed attachments.                                                                                                                                                                                                             |
| 17  | P2       | Hover viewport changes       | Fixed: open cards subscribe to viewport transforms and observe pane size; placement respects counter-scaling and restores full text when room returns. Browser regression pans, zooms and resizes a keyboard-focused card.                                                                                                                                                                                                                                            |

### Implementation choices

- A worker was not needed for the rejected oversized inputs: the conservative synchronous preflight
  refuses them before any solver work. This keeps the available explanation immediate and gives large
  diagrams an explicit unavailable state. Increasing the supported planning budget would require another
  complexity review or moving analysis to a worker.
- Scrollable interactive hover cards were rejected after browser tests showed that tall cards can cover
  nodes, and the UX review found pointer-gap and canvas-shortcut conflicts. Full live details instead
  use the existing Properties surface, behind one disclosure; the hover keeps its compact arithmetic.
- The first canvas bundle briefly failed its split guard when clipboard imported the persistence
  normalizer. Clipboard now materializes the shared small preset constants without loading profiles.

### Verification

- Focused regressions pass, including actual native/clipboard compatibility, sparse seeded playback,
  operation counts, engine reconciliation and browser keyboard/viewport behavior. Deliberate reversions
  failed their assertions; local logs are under `tests/.output/round3-mutations/`.
- Full unit run: 460 files passed; 5,561 tests passed, four skipped, no type errors. A concurrent run
  hit existing five-second import timeouts in `actions.test.ts` and `liveRenderer.test.ts`; the full
  rerun alone passed. Timeout settings were not changed.
- Production Chromium: all 184 tests passed, with no retries, across planning, live, capacity, all four
  checks specs, inspector, HTML export, private-diagram and interop, plus accessibility and CSP. Explicit
  ports 6080–6084 were used; Playwright stopped its servers and no listeners remained.
- Production build and startup chunk guard passed. Entry budget: 103.6 kB gzip / 123.5 kB allowed.
  Generated schemas and the released skill viewer match the source. i18n validation passed with no
  errors; the new planning messages use the existing English fallback in untranslated catalogs.
- Earlier failures were corrected: paste shape expectations, nullable cache types, a static canvas
  import, accessible-description wording, hover interactions, and missing observed counters when the
  planning budget is exceeded. Lint, typecheck and format are run last before the signed commit.

## Round 2

Review: `.reviews/20261014-124138/REPORT.md` (13 P1, 7 P2). All findings verified; none rejected.
Repeated findings share fixes and regression coverage.

| #   | Finding                                  | Disposition and evidence                                                                                                                                                                                           |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Connection defaults and group identity   | Fixed: editor and agent use a pure factory; stable consumer IDs, explicit groups preserved. Editor drawn/quick-add and agent tests cover equal labels and independent delivery.                                    |
| 2   | Configuration versus live metrics        | Fixed with #6/#12: immutable tweak snapshots and shared bounded planning cache. Operation counts remain unchanged over ten counter publications; configuration/status changes invalidate.                          |
| 3   | Materialize presets before downgrade     | Fixed with #11: one persistence normalizer resolves node, setup and cumulative timeline contexts before stripping metadata; one traversal reports all losses.                                                      |
| 4   | Private legacy downloads                 | Fixed with #8: download attaches current privacy through the existing export boundary; synthetic private files download and re-import as private.                                                                  |
| 5   | Simulation-dependent upgrade defaults    | Fixed with #10: original contextual values are pinned, including sequential size/HA overrides. Native round-trips compare capacities and seeded snapshots at every step.                                           |
| 6   | Stable live planning inputs              | Confirmed duplicate of #2; shared regression covers free play and saved runs with tweaks.                                                                                                                          |
| 7   | Description sizing passes                | Fixed: descriptions use shared arithmetic without verified actionable fixes; text limit applies before explanations. One analysis for 82 overloaded services; limited output generates at most eight explanations. |
| 8   | Privacy on legacy export                 | Confirmed duplicate of #4; native JSON and Interactive HTML paths also have private P1 round-trip coverage.                                                                                                        |
| 9   | Upstream label amplification             | Fixed: incoming index, unique upstream peers, at most 24 contributors and 2,048 label characters, with omitted count. Synthetic parallel edges prove bounded reads and text.                                       |
| 10  | Saved device-size overrides              | Confirmed duplicate of #5; F5 and router setup/timeline overrides retain capacity and playback.                                                                                                                    |
| 11  | Sparse preset defaults                   | Confirmed duplicate of #3; accepted preset-only active-active F5 preserves replicas and playback through legacy export and re-import.                                                                              |
| 12  | Live publications invalidate memoization | Confirmed duplicate of #2; inspector and hover share configured analysis/explanation and update observed counters separately.                                                                                      |
| 13  | Applying fixes loses live statuses       | Fixed: click reads latest controller state; both displayed analysis and sizing verification retain statuses. Unit verification and browser timeline-outage Apply cover it.                                         |
| 14  | Focus after disappearing actions         | Fixed: surviving explanation/Label receives focus after Apply; preview receives focus after Upgrade. Keyboard browser assertions.                                                                                  |
| 15  | Space below hover                        | Fixed: compare both sides, clamp final position, compact excessively tall content; pure placement and short-viewport browser coverage.                                                                             |
| 16  | Native validator loads React             | Fixed: React-free translation core with separate locale hook. Standalone bundle asserts no React runtime.                                                                                                          |
| 17  | Whole-file v2 paste                      | Fixed: accept supported v2 with revision check and existing validation/privacy handling; private exported v2 paste regression.                                                                                     |
| 18  | Hostile timeline node ID                 | Fixed: type-check before interpolation, fixed malformed-ID fallback. Parser returns a validation failure instead of throwing.                                                                                      |
| 19  | Playback parity assertion                | Fixed test: inspect playback-only resolver results before analysis; seeded processing count proves setup concurrency. Analysis is checked independently.                                                           |
| 20  | Base versus multiplied replica counts    | Fixed: explicit base count, arithmetic fallback uses base units; Capacity ×3 regression checks rendered text.                                                                                                      |

Every unit regression was tested with its fix temporarily reverted (or a targeted deliberate regression), then
restored. Privacy, focus, placement and Apply also receive production-build browser regression probes.

Rejected implementation approaches: labels as identities merge unrelated consumers; per-node verified description
fixes repeat whole-graph work; scroll-only hover clipping is inaccessible in the pointer-inert badge layer; absolute
millisecond performance budgets vary by machine. The fixes use existing contextual surfaces and operation counts.

Validation: 452 unit files passed (5,439 tests, four existing skips); 139 production Chromium tests passed on
ports 6080–6084, including planning, all live, capacity, all checks, inspector, HTML export and privacy suites.
Twelve unit regression probes and all five browser regression probes failed as intended with fixes reverted.
Build/entry budget and i18n validation passed; missing translations remain warnings with English fallback.
The skill viewer was released again after rebase and its plugin version set to 1.1.11 (master is 1.1.10).

Initial gate failures were corrected: the translation-core extraction added a startup request (now folded into
the existing i18n chunk without weakening the pinned bundle test); hook lint rejected the manual memo's mutable
cache dependency (rows now live in the shared cache); the first two browser regressions incorrectly
left the Live inspector collapsed and attempted unsupported direct HTML import (now open Properties and import
the exported HTML's embedded native payload). No findings were dismissed because of those test failures.
