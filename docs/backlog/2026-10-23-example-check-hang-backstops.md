## Native public-example checks can exhaust their hang backstop

The review-loop follow-up's native `pnpm test --maxWorkers=1` run timed out in
`src/checks/examples.test.ts`: the `blocking-call` static check, and the `retry-storm` and
`blocking-call` simulation-evidence cases. These hit the existing five-second test hang backstop;
this PR changes no example, simulation or checks implementation.

The same test file was run twice on a clean detached checkout of origin/master at
`2c6a463cb0f79dfd44c025c06aad486120ddacc9`, inside this workspace, using the same frozen dependencies.
The first repetition reproduced the `blocking-call` static-check and `retry-storm` evidence
timeouts: 2 failed, 102 passed (including type checks). The second passed all 104 checks. The
`blocking-call` evidence timeout did not recur in those two isolated repetitions. This records the
observed variation rather than claiming every native timeout reproduced individually.

Reproduce with `pnpm test src/checks/examples.test.ts --maxWorkers=1` under native host load.
Owner: Live Diagrams maintainers. Follow up by splitting or bounding the heavy example workloads
while preserving their semantic assertions; do not weaken an assertion or re-record output goldens.
No full clean-master suite was run.
