## Full local gate after the Nightly locale fix

The single post-commit Linux full gate tested signed commit
`857948152e4343daa3f6a71e6f5a80d519344e1c`, based on clean synced master
`5222dd65c`. Reports: `tests/.output/g/rS1KpTo`.

Docker smoke, lint, typecheck, formatting, i18n, skill freshness, the complete unit/heavy
suite, production build, size, all four browser build profiles and parity passed.
The heavy lane's reported successes include five expected-failure cases; those behaved
as expected. Existing skips remain: 13 unit/heavy and 11 browser cases. This branch
adds no skip, quarantine, retry, timeout, tolerance, reserve or golden change.

The browser sweep failed 11 of 2,995 cases, with 2,973 passed, 11 skipped and zero flaky.
No second full suite is scheduled. Only the failed spec families are checked twice on
a clean master snapshot, following the verification-budget rule.

```text
SUMMARY: 857948152e4343daa3f6a71e6f5a80d519344e1c | unit={"passed":14358,"failed":0,"skipped":13} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":2973,"failed":11,"flaky":0,"skipped":11} gate_failures=1
```

## Failure boundaries

| Failure                                                                                                    | Group                                          | Evidence                                                                                                                                                                              | Status / next investigation                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rail-labels.spec.ts:120`, 1280px rail: `pt-PT`, `ro`, `ru`, `sk`, `sl`, `sr-Latn`, `sv`, `th`, `tr`, `uk` | Platform/browser lifecycle suspected; unproven | All ten report `Tearing down "context" exceeded the test timeout of 30000ms`. This is not the Nightly Greek label-wrapping assertion.                                                 | Focused clean-master probe below. Preserve the assertions and backstop; inspect context-close protocol/trace and gallery-preview worker/GPU teardown before proposing a fix. |
| `tutorials.spec.ts:927`, `study-payments: Skip-all finishes without saving a diagram`                      | Product/test race unproven                     | `skipAll` at line 306 still sees `data-step="survive-psp-brownout"`, after its authored-clock advancement helper returned. The supplied queue already records this signature on #361. | Focused clean-master probe below. Capture reference replay readiness and the tutorial transition journal; do not add a second Skip click or relax completion.                |

Both spec files and all application/engine sources are byte-identical to the synced
master baseline. The locale matcher fix affects other test files only. This establishes
the diff's scope, not a reproduced root cause for either failure family.

The rail failure's browser log includes `SharedImageManager::ProduceMemory` mailbox
errors. A later sample showed about 8.8 GiB container use out of 31.2 GiB and no
container OOM event. These observations do not establish the cause or rule out a
transient resource problem. No browser, server, TURN or tracker configuration changes
are made to suppress the failure.

## Focused master check

An independent clean detached snapshot of `5222dd65c` lives inside this
checkout at `tests/.output/nightly-1028-master-proof`. It has its own frozen dependency
install. Initial dependency-link preflights failed before any tests ran; a real install
corrected setup without bypassing pnpm's dependency verification.

The selected command runs only the rail spec and the tutorial Skip-all declaration,
twice, with ten workers and ten CPUs on ports 6560–6564:

```text
pnpm gate quick tests/e2e/rail-labels.spec.ts tests/e2e/tutorials.spec.ts:927 --linux --only e2e --repeat 2 --workers 10 --cpus 10 --ports 6560 --max-wait 1
```

Both repetitions passed **132/132**, for **264 passed, 0 failed, 0 flaky, 0 skipped**.
Reports: `tests/.output/nightly-1028-master-proof/tests/.output/g/r4afCny`.

```text
SUMMARY: 5222dd65cda031ad697d29941b0d2b0df2b11190 | unit="not run" parity="not run" e2e={"passed":264,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

**Neither signature is a confirmed clean-master reproduction.** The passing isolated
checks do not establish why the full sweep failed, or prove either failure fixed.
Preserve the full-run traces and investigate suite history/load and browser teardown,
plus the tutorial's reference/clock transition boundary. The two files and application
sources have no diff against the baseline; this alone is not a reproduced cause.

Per the verification-budget rule, record these results and push for PR CI's zero-retry
gate instead of repeating full local suites. The follow-up commit changes documentation
only; all application and test code remains exactly as tested by the full gate. The
locale fix's separate before/after evidence remains green: 14 dev cases, five new unit
cases, and both complete touched browser specs twice (258 Linux production passes).
