## Slow-motion test exhausts its whole-test deadline under load

`tests/e2e/slowmo.spec.ts:135`, "from a node: the background freezes, at most 4
dots move, captions tell each hop", intermittently reaches Playwright's existing
30-second whole-test timeout in the Linux load run. The native focused gate
passes all 69 tests.

The same case and whole-test timeout reproduce on a clean `origin/master`
checkout at `ee61494c7c3f43326aedd928f09e37bcf5adf122`, exported into an ignored
scratch checkout inside the working repository. Both first repetitions report
68 passed and 1 failed. The checkout stays clean; no test or application changes
are applied there.

Both traces complete the 40-step background-freeze and caption loop. The branch
trace expires at the final `live-more` click; the clean-master trace expires at
the preceding first `trace-hop-seek-` click. These are whole-test deadline
failures, rather than failed freeze, dot-count or caption assertions.

Run from either checkout with the same configuration:

```sh
pnpm gate quick tests/e2e/live.spec.ts tests/e2e/slowmo.spec.ts tests/e2e/present.spec.ts tests/e2e/trace.spec.ts --linux --only e2e --repeat 3 --workers 8 --cpus 4 --memory 12g --ports 6840 --max-wait 1
```

Investigate the loop's browser protocol round trips and final fake-clock
interactions while retaining every assertion. Do not enlarge the timeout or
weaken the camera, freeze, particle or caption checks to hide the failure. This
interface-only refactor leaves the existing test and production behavior intact.

Branch code: one timeout in the first repetition; the other two repetitions pass
all 69 cases.

```text
SUMMARY: d5347142b59d4aba15dd430c303a4788cb417d53 | unit="not run" parity="not run" e2e={"passed":206,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

Clean `origin/master`: the same case reaches the same whole-test timeout in all
three repetitions, with every other case passing.

```text
SUMMARY: ee61494c7c3f43326aedd928f09e37bcf5adf122 | unit="not run" parity="not run" e2e={"passed":204,"failed":3,"flaky":0,"skipped":0} gate_failures=3
```

## Resolved in follow-ups seven

The release note `docs/release-notes/2026-10-18-followups-seven.md` records the fix and regression
coverage. The original clean-master reproduction above is retained as evidence; no threshold or
assertion was relaxed.
