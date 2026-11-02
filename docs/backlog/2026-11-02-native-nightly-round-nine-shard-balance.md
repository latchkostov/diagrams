## Interrupted Linux Build cohort

Branch Nightly [41406762649](https://github.com/latchkostov/diagrams/actions/runs/41406762649),
application/test head 68e74de764b01f60c1e0cb7acc3cfa8239280b6f, completes every Dev shard:
3,305 passed, zero failed or unfinished, 50 existing skips. Build x3 records 10,010 passes,
zero test failures, 33 existing skips and **22 unfinished** when shard 3 exhausts its existing
30-minute workflow step. This is an unsuccessful Build verification, not a green run.

The interrupted shard completes 881 of 903 executions. The remaining work is in
`collab-room-relay.spec.ts` and `image-resources.spec.ts`. Its completed tests total about 4,853
seconds across workers. The stale partition underestimates the shard's cost, including the expanded
rail-label corpus. No timeout, test limit, assertion, tolerance, worker count or shard count is raised.

Only those two specs run twice on clean origin/master, 54bb1185e504883b52cd867f081bb2220fe0fd77,
in this same worktree. Both repeats pass: 26 executions, including the dev project. This does **not**
reproduce the workflow interruption and is not claimed as proof of a pre-existing identical failure.
The working branch is restored afterward, without a stash, rebase or another checkout directory.

```text
SUMMARY: 54bb1185e504883b52cd867f081bb2220fe0fd77 | unit="not run" parity="not run" e2e={"passed":26,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Complete measurements for shard estimates

Timing refreshes now ignore interrupted checkpoint reports. Their missing tests underestimate a
file's full cost, and flattened suite titles can give the same samples different identities when
combined with complete reports. The regression supplies both forms: the original updater double
counts one sample and replaces another file's previous complete cost with its partial cost. It fails
again when the repair is temporarily reverted; the fixed updater retains only complete measurements.

`node scripts/e2e-shard.mjs --update` refreshes the timing data from this Nightly's twenty Linux
result reports, using nineteen complete reports and excluding the interrupted one. It records 204
measured files; the unmeasured all-skipped file retains the existing mean-estimate behavior. These
values allocate work between jobs; they are not test deadlines or budgets.

Using those same measurements to score both twelve-shard plans, the largest old assignment estimates
2,124 seconds of test work; the new largest assignment estimates 1,604 (ratio 0.755). These are planning
estimates, not a claimed observed runtime improvement. Every spec remains assigned exactly once.
The browser corpus, three Build repetitions, workers and all workflow limits stay unchanged.

## Verification

The sharding and CI unit cohorts pass all 38 cases. The new regression fails with the original updater
and with a temporary reversion, including both the duplicate and incomplete-cost errors. Application
and browser test bytes are unchanged by this harness correction. A fresh branch Nightly will verify
the redistributed work; retain the interrupted first run above in the final report.

The Linux harness gate then passes 43 unit cases and full parity, all 3,178 goldens unchanged.
No output is re-recorded. The SHA in this quick-gate summary is its starting HEAD with the harness
edits present, not a clean committed-head verification stamp.

```text
SUMMARY: 68e74de764b01f60c1e0cb7acc3cfa8239280b6f | unit={"passed":43,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":0,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Native follow-ups observed in the first dispatch

Windows completes 3,328 passes, 12 failures, 15 existing skips and zero unfinished cases. macOS is
still finishing at this record; both platforms pass the new focus regression and annotation reload.
The first-dispatch native inventory remains separate from verification of the new shard allocation.

- Product state first: Windows AI-panel Undo restores a hidden queue; Properties fails to expose the
  title in both planning-P2 revision tests. Verified busy-thread fixes, scaling disclosure and the
  saved-input notice need their actual revision and focus state checked before changing drivers.
- Tutorial keyboard and replay: macOS quick-add stays at grow, study-payments leaves quick-add open
  after command navigation, and route-by-address, kafka-topic and cache-aside lose their expected
  keyboard destination. Pointer study-payments stays at never-double-charge. Windows scale-to-zero,
  study-payments brownout and the held where-time-goes renderer also fail. macOS fault Restore fails
  to expose its fault-menu action. Keep the assertions and establish the missing transition.
- Scroll: macOS presentation Home stops at 30 px in latency details. This recurs as a behavior group
  from round 8; the protected edge-navigation camera rule and low-zoom review remain unchanged.
- Capture/setup: Windows main-path recording stalls at Stop, its following caption case fails to
  mount Live, and the held-settings case fails initial canvas navigation. macOS bundle replay hits
  its whole-test limit. These belong to the previously recorded capture/readiness groups; the
  observed stage is not proof that every failure shares a cause.
