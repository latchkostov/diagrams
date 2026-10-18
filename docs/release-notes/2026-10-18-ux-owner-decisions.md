## UX owner decisions

Going Live on a gallery example starts its first saved simulation, just like Run it. Free play is one picker choice away. Personal diagrams keep their existing Free play default; explicit Live links keep their selected simulation or Free play, so reloading a chosen Free play link remains stable.

The picker, panel and More menu retain **Simulations**. The vocabulary now defines Fault as the action and Drill as a saved simulation with fault steps; drill remains gallery and example copy.

A completed run replaces narration with one translated result sentence. It names the largest node loss in real message units and uses the node label, never its ID. A zero-loss run says “No messages lost”; failed or unevaluated expectations are disclosed in that same sentence. Counts stay generic messages rather than guessing an inflected noun from authored labels or message types.

During a drill, each effective fault change (including restoring it or changing its magnitude) clears aggregate and per-type latency histograms. Counters, messages in flight and traffic keep running. The existing muted hover scope line names the change; no-op fault actions keep the window, Free play stays cumulative, and restart resets everything. Checkpoints restore both samples and their scope.

Where the time goes adds a nine-second Slow Billing drill: slow at 3 s, restore at 6 s, with narration explaining each new window. Generated gallery metadata tags it for latency and fault drills. The existing spike and steady runs are unchanged.

## Output parity

Intentional changes, relative to `tests/parity/goldens/node/`:

| Goldens                                                                                                                                                                                                                                                                               | Reason                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `agent/check/where-the-time-goes.json`, `evidence/where-the-time-goes.json`                                                                                                                                                                                                           | Include the third saved run, with unchanged findings.                                              |
| `agent/describe/where-the-time-goes.json`, `agent/edit/where-the-time-goes.json`                                                                                                                                                                                                      | Include the new drill and its fault/narration steps.                                               |
| `planning/where-the-time-goes.json`, `planning-p2/where-the-time-goes.json`                                                                                                                                                                                                           | Add the drill's traffic/capacity analysis and automatic scale. Existing runs retain their results. |
| `exports/native/where-the-time-goes.diagram.json`, `exports/drawio/where-the-time-goes.drawio`, `exports/drawio-meta/where-the-time-goes.json`, `exports/html/where-the-time-goes.light.json`, `exports/html/where-the-time-goes.dark.json`, `skill/scripts/where-the-time-goes.json` | Preserve the third simulation in exported metadata, fingerprints and share links.                  |
| `skill/validate/where-the-time-goes.txt`                                                                                                                                                                                                                                              | Reports three valid simulations.                                                                   |
| `i18n/catalogs.json`                                                                                                                                                                                                                                                                  | Adds translated result and fault-window messages, with English fallback in untranslated locales.   |

Five new goldens cover the new run: `sim/where-the-time-goes/slow-billing-drill.json`, `latency/where-the-time-goes/slow-billing-drill.json`, and `trace/where-the-time-goes/slow-billing-drill.{json,mmd,dead-letter.json}`. No existing simulation traffic, latency distribution or browser layout/render golden is intentionally changed.

## Validation

The restored implementation passes 209 targeted unit/build tests in 20 files, including the startup chunk contract, standalone export and Properties rendering. The fault-drill browser spec passed all 15 tests. The latency spec passed all seven after correcting the translated pseudo-locale expectation and keeping the existing Properties hint visible when a shorter result leaves room for the full hover. All geometry/clearance assertions remain intact. Production build and entry size pass: 102.4 kB gzip against 123.5 kB.

Temporarily reverting example selection, the result and fault-window reset fails both new unit regressions and all three focused browser regressions. Restoring them passes. The first complete unit run reported 11,172 passed, six unrelated runtime timeouts and 12 skipped, plus stale catalog imports during edits and a Properties prop typo. The prop and imports are corrected and their affected tests pass. Every runtime timeout reproduced in the targeted clean-master checks; evidence and environment limits are in `docs/backlog/2026-10-18-ux-owner-verification-load.md`. No full unit suite was repeated.

The completed parity check reports 2,369 goldens, zero changed/added/missing/stale, and 83 passing Linux browser cases. The intended update is the 14 changed and five added goldens listed above. Regeneration and i18n validation pass with zero errors; untranslated messages use the existing fallback policy. The five-repeat Linux neighbor gate exited busy (75); no repeat was run and no lock was removed.
