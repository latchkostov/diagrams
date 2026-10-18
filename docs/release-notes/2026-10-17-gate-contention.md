## Gate contention and remote browser comparisons

Per-branch verification now defaults to quick local checks and targeted specs, followed by PR CI as
the full gate. Full local runs remain available for flake hunts, red CI and optional pre-push checks.
Timing-sensitive UI still needs targeted load repeats.

Local gates share a CPU/RAM worker budget with FIFO admission. Small quick runs can overlap;
default full runs reserve the whole budget. Waiters show worktree, branch, command, PID, start and
elapsed time every 15 seconds. `--max-wait 1` exits 75 when busy, recommending CI or a later retry.
Each reservation is backed by an OS socket, so dead processes cannot leave capacity locked.
Vitest, browser parity and Linux CPU quotas follow the declared worker budget.

The new **Compare browser benchmarks** Actions workflow runs selected browser benchmarks for base
and head sequentially in the same job, with matching title filter, mode and CPU throttle, and posts
the comparison in the job summary. This is the default comparison path, avoiding local contention.

No app output changes are intended; parity goldens are unchanged.
The committed skill viewer is refreshed by `pnpm regen` to match the current sources.
