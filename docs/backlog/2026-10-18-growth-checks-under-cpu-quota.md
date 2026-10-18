## Growth checks under a two-CPU quota (2026-10-18)

Three existing unit growth assertions failed during camera/seed validation with four workers,
two Linux CPUs and 8 GiB memory. All three reproduce at the same assertions on untouched
`origin/master` commit `ee61494c7c3f43326aedd928f09e37bcf5adf122`, exported with `git archive`
by the gate in this worktree. The first master run reproduced the two import failures; the
second reproduced all three. No assertion, threshold, input or retry was changed.

| Test / assertion                                                     |   Fix branch ratio | Clean master ratio (second run) | Required |
| -------------------------------------------------------------------- | -----------------: | ------------------------------: | -------: |
| `src/collab/scale.test.ts:147`, 5,000-node growth, `project`         | 47.770747686196565 |              25.757020079638817 |     < 24 |
| `src/interop/uniqueIds.test.ts:366`, repeated draw.io connection IDs |  31.37081845202772 |              27.354764112847853 |     < 24 |
| `src/interop/infra/asyncapi.test.ts:568`, remote-reference scanning  |  29.65714431948458 |                24.5461503308463 |     < 24 |

Master reproduction (clean checkout, same CPU/worker/memory limits):

```sh
pnpm gate full --linux --only unit --workers 4 --cpus 2 --memory 8g --ports 6860 --max-wait 1
```

The fix branch's quick gate used those limits and repeated the 11 affected camera/slow-motion
and neighbouring browser spec files five times. Every browser repetition passed: 765 passed,
zero failed or flaky. Separate native local and CI unit runs each passed 10,405 tests, with four
skipped; full parity matched 2,196 goldens without updates.

Exact gate summaries (the fix's later documentation changes do not change executable code):

```text
SUMMARY: 01a7595d0e52a7d9fe4711a1c13cf868e0f9a654 | unit={"passed":10402,"failed":3,"skipped":4} parity="not run" e2e={"passed":765,"failed":0,"flaky":0,"skipped":0} gate_failures=1
SUMMARY: ee61494c7c3f43326aedd928f09e37bcf5adf122 | unit={"passed":10389,"failed":3,"skipped":4} parity="not run" e2e={"passed":0,"failed":0,"flaky":0,"skipped":0} gate_failures=1
```

Follow up by investigating these measurements under CPU quotas and replacing them with operation
counts where practical. Preserve the eighth-sized comparison input and linear limit of 24;
do not hide the failures with retries or wider thresholds.

## Resolved in follow-ups seven

The release note `docs/release-notes/2026-10-18-followups-seven.md` records the fix and regression
coverage. The original clean-master reproduction above is retained as evidence; no threshold or
assertion was relaxed.
