## Pre-existing resilience recovery failure

PR #282's requested Node 24, CI=true sweep (40 seeds at multiplier 5 plus four at
multiplier 20) found seed `538282733` at multiplier 5. The first property in
`src/sim/resilience.invariants.heavy.test.ts` leaves 11 messages in the system after
`recover` exhausts its finite work bound: `expected 11 to be +0`.

The minimized scenario uses scale 1.01, four processor tiers, two-slot finite pools,
361 ms deadlines, nested retries and a non-blocking side request. All request edges
have finite pools; #282's queue-time correction applies only to unbounded pools.
Investigate request cleanup versus the recovery work bound without weakening the
drain assertion or changing sampling caps.

## Clean-master evidence

Replayed only the failing property and its reduced fast-check path twice on clean
`origin/master`, commit `e82d178b0dbf4e34b937d8c6e3826a195b1291a5`, in the same
checkout. Both runs failed identically with 11 messages remaining:

- Replay 1: 1 failed, 3 skipped; 40.83 seconds.
- Replay 2: 1 failed, 3 skipped; 31.62 seconds.

No other worktree or full suite was used. The checkout returned to the fix branch
after both runs. The engine, ledger, resilience generator and failing spec on master
also match the pre-fix branch's versions.

## Exact reduced replay

Run twice on Node 24, from PowerShell:

```powershell
$env:CI = 'true'
$env:FC_SEED = '538282733'
$env:FC_RUN_MULTIPLIER = '5'
$env:FC_PATH = '149:3:2:2:2:3:4:3:3:4:10:6:6:6:9:10:11:11:15:11:11:11:12:12:13:14:13:13:14:15:14:14:15:20:16:16:16:16:17:17:17:18:23:11:10:6:6:6:9:7:6:9:10:15:10:17:6:6:10:6:6:6:10:10:10:15:11:10:17:6:9:8:17:17:17:17:6:9:7:17:21:10:14:6:6:9:7:6:10:10:10:17:10:10:15:10:10:10:17:6:9:6:6:6:17:17:17:17:21:10:6:8:7:13:12:17:6:6:8:6:6:6:17:14:14:19:15:17:17:17:17:10:10:14:11:19:20:17:17:18:21:19:19:20:23:23'
1..2 | ForEach-Object {
  pnpm exec vitest run src/sim/resilience.invariants.heavy.test.ts -t 'budgets, pools, failures, outage' --maxWorkers 1
}
```

## Initial sweep summary

`SUMMARY: 36 passed, 1 failed, 7 unrun; 2546.41s`

All seven unrun original seeds subsequently passed with the same files, seed values,
multipliers, CI environment and two-worker admission budget. The remainder runner
exited before recording its final two seeds; only those two unfinished seeds were
restarted through the repository's sweep command. Both passed:

`SUMMARY: 2 passed, 0 failed, 0 unrun; 238.17s`

## Complete sweep result

`SUMMARY: 43 passed, 1 failed, 0 unrun (combined 40x5 + 4x20)`

All 44 original seeds have results: 39 of the 40 multiplier-5 seeds and all four
multiplier-20 seeds passed. The pre-existing failure remains recorded as a failure;
no assertion, generator, golden or quarantine was changed to suppress it.
