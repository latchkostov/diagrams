## Existing held-inspector Escape failure

P-05's required Linux neighbour sweep hit `inspector-live.spec.ts` →
`held connection EdgePanel chunk preserves rename keys and Escape` in all five repetitions.
The label had `test label` as expected but regained focus after the held chunk was released;
`expect(label).not.toBeFocused()` failed. No assertion or timeout was changed.

The same assertion reproduced on clean `origin/master` source
`62e064a13b31010b15e3ef9a50cdf98968403cff`, checked out under the worktree's ignored test-output directory.
Only the inspector spec ran, twice, while the other Linux stress run continued:

```text
pnpm gate quick tests/e2e/inspector-live.spec.ts --linux --only e2e --repeat 2 --workers 1 --cpus 1 --max-wait 1
SUMMARY: 62e064a13b31010b15e3ef9a50cdf98968403cff | unit="not run" parity="not run" e2e={"passed":41,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

The first master repetition passed 21 cases; the second passed 20 and failed the same EdgePanel/Escape
case. Investigate pending rename cancellation and late field focus in a separate inspector fix.
P-05 leaves that test and its interaction owner unchanged. Its new discovery cases passed in each
stress repetition. No full suite was run on master to establish this failure.
