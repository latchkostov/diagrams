## Focused typing fix: unit timeouts under load

The four-worker unit run passed all 761 files: 15,216 passed, nine expected failures and ten skipped.
After the final native-markup change, a six-worker unit run alongside the six-CPU Linux browser gate
reported six existing five-second test backstops (755 files passed; 15,215 tests passed):

- `src/live/decorations.test.ts`: continuous queue attention, `three-quick-retries`.
- `src/lib/bundleHeadroom.test.ts`: static Inspector imports.
- `src/lib/fragments.test.ts`: repository text encoding.
- `src/lib/gestureListeners.test.ts`: interaction-adapter pointer listeners.
- `src/lib/portableModifiers.test.ts`: primary-modifier lint rule.
- `src/static/pages.build.test.ts`: standalone German catalog.

Only these files were rechecked. All passed on the branch: decorations twice (13 tests each), and
the remaining five files together (21 tests). Clean tracked sources archived from `origin/master`
at `641c94ec572e24ac99d417bd9281da4e29372a81`, inside this checkout's ignored output directory,
were checked against the same verified installed dependencies. Decorations passed twice. The other
five files ran twice: the first reproduced the identical German catalog five-second timeout
(20 passed, one failed), and the second passed all 21 tests. The other five timeout identities did
not reproduce in these focused master runs; they remain load-sensitive observations.

Investigate the expensive checks without dropping cases, weakening assertions or raising timeouts.
No full suite was run on master. The requested Linux browser specs passed both repetitions
(506 passed, zero failed/flaky), and output parity left all 3,342 goldens unchanged.

Local evidence: `tests/.output/typing-unit.log`, `typing-unit-final.log`,
`typing-master-decorations-{1,2}.log`, `typing-master-other-{1,2}.log`,
`typing-decorations-recheck-{1,2}.log`, `typing-other-recheck.log`, and gate `g/rlNsiHm/`.
