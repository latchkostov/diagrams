## Clean-master Linux stress failures

The pan-scale verification ran eight Playwright workers sharing four Linux CPUs. A single clean-master
comparison of the six failed spec files, repeated twice, reproduced seven of the nine failed cases.
The baseline was `ea2622c4221b6787c3a689b757eb8a2a4d66dbf3`; no source, assertion or timeout was changed.

| Case                                                                      | Branch occurrences | Clean-master occurrences |
| ------------------------------------------------------------------------- | -----------------: | -----------------------: |
| a11y stencils, light and dark: test timeout                               |                  4 |                        4 |
| lazy-live-fixes pending script: expected playing, received done, line 383 |                  2 |                        2 |
| workbench-overview large Overview, light: test timeout                    |                  2 |                        2 |
| perf zoom snap radius: waitForChecks setup predicate, line 341            |                  2 |                        2 |
| perf menu hover: same waitForChecks setup predicate                       |                  2 |                        1 |
| lowzoom-chips natural image export: test timeout                          |                  2 |                        2 |

```text
SUMMARY: ea2622c4221b6787c3a689b757eb8a2a4d66dbf3 | unit="not run" parity="not run" e2e={"passed":161,"failed":13,"flaky":0,"skipped":0} gate_failures=2
```

The dark Overview and Live off-screen-entry backstop failures did not reproduce on master and are not
classified as pre-existing. Their existing all-title visibility and complete accessible-name checks are
batched without dropping any condition; the first-frame, geometry and readability checks remain.
The targeted follow-up result is recorded in the design review and PR.

## Follow-up

Resolve the stencil scan and natural-export backstops, the pending-script test's running clock, and the
perf fixtures' pending background checks under this load. Preserve the existing assertions and limits.
The Overview visibility batching addresses the duplicated round trips in this branch. Both affected
specs passed twice afterward (20 cases); Overview is not an open item in this follow-up.

Local evidence: `tests/.output/pan-master-late-failures.log`, report `rbGiinN`, and
`tests/.output/pan-native-final-browser.log`, report `rGcA7Fh`.
