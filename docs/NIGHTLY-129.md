# Nightly #129 investigation

Scope: the six assigned canvas, layout, live, naming and capacity failures from
[run 38851345020](https://github.com/latchkostov/diagrams/actions/runs/38851345020),
master `16060ab9`. Work starts from current `origin/master`, `840ad022` (the subsequent research
merge). Promotion and save-destination implementation is outside this change.

The run's JSON reports, failure traces, screenshots and complete job logs were downloaded to
ignored `tests/.output/nightly129/`. The workflow runs every test once on dev and three times on
the production bundle, without retries. The available nightly history has no successful run;
the preceding nightly ran `db7f9e50`. The intervening log includes #118, #125, #126 and #127.
The relevant changes are lazy gallery/dialog loading (#118), the larger validation graph (#125),
and input cancelling settled-view refinements (#126). #127's benchmarks do not explain a changed
simulation contract.

## Evidence and corrections

| Test                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                            | Correction                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Complete export contract     | The download completes before its lazy success notification. The import changes the document slug, but the failed assertion observes the export notification instead of the import notification. Neither exported data comparison failed.                                                                                                                                                                           | Wait for export completion feedback before starting the next operation; also assert that import opens a different document before checking its feedback. Preserve all three complete-file comparisons. |
| Light layout audit, part 1/8 | The trace shows four cold full navigations: the last starts 22.6 seconds into the test. Its canvas arrives just before the 30-second test deadline, which expires in the final stable-box wait. The screenshot is the correct fourth fixture.                                                                                                                                                                       | One fixture per test, in both themes; keep every overlap/chrome check and remove the old zero-node skip. No larger audit timeout.                                                                      |
| Storm survives reload        | Initial live readiness takes about 16.7 seconds. Saving and persisted-content checks finish; reload starts about 19.7 seconds in. The deadline expires waiting for the reloaded live session, while the canvas and Live toggle are already visible.                                                                                                                                                                 | Keep the save/persistence/reload assertions. Use the page-loading readiness allowance for the reloaded session and mark this two-navigation flow slow.                                                 |
| Naming preserves a saved run | The enclosing hook first loads the unrelated naming fixture. The test discards it and loads the public saved run. Those navigations consume about 27.7 seconds before authoring starts; the test deadline expires in the viewport wait, with the edited title still visible.                                                                                                                                        | Move this test outside that seeding hook and open the saved public run directly. Keep focus, dirty state, title and active-run assertions.                                                             |
| Apply fix focus, both modes  | Both production traces fail clicking Payments: Playwright repeatedly reports it outside the viewport. The screenshot shows a clipped view after panel/mode changes and keyboard input; no announcement-focus assertion failed. Input can cancel the pending refit.                                                                                                                                                  | Explicitly fit before interacting with that node. Keep both keyboard activation and announcement-focus checks.                                                                                         |
| Escape backs out             | The final Escape fails, after picker cancellation, panel closure and focus restoration have passed. Local event-handler instrumentation reproduces it: other handlers receive the final key, but the live session handler is removed before it is reached. Host/session publication rerenders `LiveView`; its inline exit callback changes the session effect dependency and replaces the listener during dispatch. | Stabilize the exit callback. The Lab forces a host commit in an earlier capture handler; the same Escape must still leave Live.                                                                        |

The Escape regression passes with the stable callback and fails when just the inline callback is
temporarily restored (Live remains on). The full original Escape flow also reproduces locally
with instrumentation and passes fifteen consecutive cycles after the correction.

Two further controlled reversions keep the original assertions intact. Deferring only the export
notification, then delivering it when import feedback appears (with a 24-frame release backstop),
passes with the export-feedback wait and fails without it: the assertion sees exactly the nightly's
`Exported 2 nodes and 1 edges` message. Panning the capacity target outside the canvas passes with
the explicit fit and fails without it at the Payments click, again reporting an off-screen target.
These temporary controls are removed from the final test tree.

Rejected: sleeps, retrying missed keypresses/clicks, forcing off-screen clicks, dropping the import
feedback assertion, raising the layout audit timeout, changing simulation validation, and recording
new goldens. These would conceal the ordering or readiness problem or weaken the contracts.

## Verification

Initial unchanged local reproduction: six dev tests passed with four workers; all eighteen
production runs passed with four workers and `--repeat-each=3`. A further twenty production
capacity/Escape runs at 6× CPU throttling also passed, illustrating why repetition alone is
insufficient to prove the event-ordering correction. The deterministic Escape regression supplies
the deliberate-reversion check.

The original dev tests were also temporarily restored and run with four workers and 6× CDP CPU
throttling: layout, storm and saved-run naming failed, while the export test passed. Layout and
naming exhausted their test deadlines; storm hit the existing menu helper's short action/retry
limits earlier than the nightly's reload failure. A 3× run of the same originals passed all four.
These experiments demonstrate load sensitivity, not a simulation-data regression.

Final focused runs on explicit ports 6400–6404, four workers, no retries:

- Dev: `--repeat-each=10`, **100 passed, 0 failed, 0 flaky**.
- Fresh `VITE_E2E=1` production bundle: the same repeats, **100 passed, 0 failed, 0 flaky**.
- Each run covers the six assigned tests, all four individually split fixtures from the original
  layout part, and the new deterministic Escape regression.
- `pnpm i18n check`: zero errors, existing catalog gaps/warnings unchanged. `pnpm skill:check`
  passes after refreshing the viewer; the initial plugin version was 1.1.27 (master was 1.1.26).
- Pre-commit `pnpm parity`: 72 browser tests passed; all **1,862 goldens unchanged**, none added,
  missing or stale. No update command was run.

The pre-commit parity run and the signed commit's complete gate use unchanged goldens. The final
post-commit command is `bash /c/Users/latch/bin/verify-push.sh 6400`; its per-shard totals and exact
summary are reported with the pushed commit. Logs remain under ignored `tests/.output/`.

## Refresh and baseline gate failure

While the gate was queued, origin/master advanced to `06e3e0ca` (#131 and #132), with plugin
1.1.27. The scoped patch is reapplied to that current master in this same worktree. Both release-note
entries are retained, and the viewer is regenerated from the combined source at plugin **1.1.28**.

The first full gate on the initial implementation commit `0f27373f` passed lint, typecheck, format,
7,397 unit tests (four existing skips), build, size and parity, then reported:

```text
SUMMARY: 0f27373faae63bdba7b9015c71684129928169b1 | shards=6 passed=1292 failed=1 flaky=0 skipped=0 gate_failures=1
```

The sole failure was `autoscaling.spec.ts:525`, “A1 startup timing is independent of page readiness”,
which exhausted its 30-second deadline in the final ready-replica assertion. A clean detached checkout
of current `origin/master` (`06e3e0ca`), with no tracked changes, rebuilt the production test bundle
and ran that test ten times with three workers and no retries: **0 passed, 10 failed, 0 flaky**.
The same final ready-replica failure occurs on master as well as earlier timeouts in the starting-replica
assertion. The fix branch is restored after the baseline run. Logs, JSON and traces are retained at
`tests/.output/nightly129/master-startup*`. No autoscaling source or assertion is changed by this patch.

After the refresh to `06e3e0ca`, the complete focused ten-repeat checks pass again with four workers:
**100/100 dev and 100/100 production**, zero failures, flakes or retries. The full-gate startup failure
is an existing master failure, so pushing remains blocked by the required green-gate rule pending
a scope decision about that additional test.

Refreshed parity passes all 72 browser tests and all **1,863 goldens unchanged**, with none added,
missing or stale. The additional committed golden comes from the newer master; this patch changes
no golden file. Skill freshness and i18n checks pass again (existing translation warnings remain).
