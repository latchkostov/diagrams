## Decision

Survey 2 item 2 remains open. The geometry-preparation prototype was rejected: the controlled
comparison missed the requested greater-than-10% improvement and did not recover 1–2 seconds from
either large action. Product code, product tests and the generated viewer were restored to master.
No budget, reserve, assertion, tolerance or golden was increased or updated.

## Controlled comparison

[Compare browser benchmarks run 40799294487](https://github.com/latchkostov/diagrams/actions/runs/40799294487)
compared base `4a3c81f69e08c830e5a75b53e0035c1675ccb0d2` with rejected prototype
`1332bfc0578d7aa2ddbe02a7cbead228030d7304`. Both ran sequentially in one Ubuntu job, one browser
worker, Chromium 156, 1440 × 900, device scale 1 and 2× main-thread CPU throttle. Each cell contains
three unprofiled fresh-context samples. Layout includes the unchanged one-second quiet observation;
Paste adds exactly 50 nodes from unchanged Overview. Times are milliseconds: median (observed
minimum–maximum), not confidence intervals.

| Action      | Parts |                Base |  Rejected prototype | Change |
| ----------- | ----: | ------------------: | ------------------: | -----: |
| Auto-layout |   500 | 3,346 (3,345–3,661) | 3,166 (3,149–3,167) |  −5.4% |
| Paste 50    |   500 | 3,481 (3,481–3,550) | 3,437 (3,432–3,487) |  −1.3% |
| Auto-layout | 1,500 | 6,824 (6,774–6,847) | 6,664 (6,542–6,880) |  −2.3% |
| Paste 50    | 1,500 | 8,630 (8,581–8,697) | 8,811 (8,648–8,884) |  +2.1% |

The `browser-benchmark-comparison` artifact retains both revisions' complete raw
`survey2/samples.jsonl` groups, resolved SHAs and `compare.md`. Local exploratory groups overlapping
another browser benchmark are excluded. An initial workflow dispatch failed checkout with a short
base SHA before measuring anything; the successful run above pins both full SHAs.

## Rejected preparation changes

The candidate scoped native animation discovery to actual fit overlays, cached it while measurements
were missing, and refreshed it on confirmation for mutation-free WAAPI entrances. It retained delayed
and paused animation completion, selector-removal invalidation and real size/route/font checks.
It shared a semantic geometry revision across readiness, frame decoration and identity, reused boxes
and route/label inputs, and tried bounded node-id caches across Overview/Focus renderer remounts.
Region title sizes were batched; unused Overview geometry work and redundant title-portal frame
invalidation were removed.

At 1,500 parts the prototype recorded five readiness, two frame and four identity passes for layout;
paste recorded three readiness, one frame and two identity passes. Animation discoveries were four
and two respectively. Geometry measurement groups/cache misses were 8,345 and 8,761; these are
instrumented groups, not an exhaustive count of every native geometry getter.

Layout's style median fell from 1,604 to 1,397 ms, but main-thread task time only fell from 6,017 to
5,862 ms. Paste's style median fell from 3,958 to 3,786 ms, while task time increased from 8,612 to
8,833 ms. Narrowing a `getAnimations` subtree does not avoid the browser's document-wide style
lifecycle update; time attributed to that native function is not all removable discovery cost.

A separate synchronous pane/chrome borrowing prototype also failed to establish a 10% action-level
benefit and was removed before this controlled comparison. No timeout, guessed readiness fallback,
DOM culling or broader rendering change was substituted.

## Correctness and reserve evidence

The candidate preserved all 3,178 parity goldens: zero changed/added/missing/stale, 110 browser cases.
The required Linux browser group and neighbours passed two repeats at six workers/six CPUs:
1,084 passed, 20 skipped, zero failures or flaky tests. Targeted unit guards passed 1,537 tests;
deliberately removing the final optimizations made 13 regressions fail.

The full local unit run reported 14,352 passed, 10 expected failures and 13 skipped, with two
unexpected failures: Live reserve (128,864 versus the unchanged 128,856 ceiling) and skill ZIP
reserve (829,845 versus the unchanged 828,856 ceiling). Further reserve experiments still failed.
These were additional reasons to reject the implementation, not reasons to raise headroom or add
an unrelated trim. The one full-gate admission attempt exited 75 while another worktree held worker
capacity. The required subset's exact summary was:

```text
SUMMARY: 91919b378afd58002389aea86e9ef40f31389457 | unit="not run" parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1084,"failed":0,"flaky":0,"skipped":20} gate_failures=0
```

That quick gate used the working prototype; it was not a clean-commit verification stamp. The final
branch retains comparison tooling and this evidence, with no product optimization claimed.
After restoring the product to master, both previously failing reserve checks pass, as do the two
comparison-reader tests. Regeneration and the skill freshness check also pass.

## Next bounded investigation

Identify the actual style-affecting mutations that force distinct browser lifecycle updates between
the React commit, readiness and final decoration. A useful next candidate must remove a complete
forced style/layout phase while preserving first-frame captions, final routes, reveal and camera
completion. Reusing unchanged JavaScript inputs alone was insufficient. Require the same paired
action measurements and unchanged output before retaining a replacement.
