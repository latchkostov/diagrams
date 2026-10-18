## Paused follow camera moves during Inspector resize

Native Windows, four logical CPUs (process affinity `0xf`), three Playwright
workers and one competing CPU process reproduce a small viewport movement in
`followups4-inspector.spec.ts`, “Inspector resize leaves a paused slow-motion
camera unchanged (follow)”. The exact-transform assertion is unchanged.

This fails twice on clean origin/master `901e836f` and twice again after syncing
to `45b68977`, in this same worktree with all branch changes stashed. The first baseline captures
`translate(11.0097px, 342.201px) scale(0.799995)` before resize and
`translate(11px, 342.2px) scale(0.8)` afterwards; another captures a partially
eased follow pan. Investigate the outstanding follow transition and the zero
duration stop, retaining the rule that resizing a paused replay keeps its exact
view. This is separate from the quarantined Windows context-close failures.

Command: `pnpm gate quick tests/e2e/followups4-inspector.spec.ts --no-docker --only e2e --workers 3 --repeat 2 --ports 6960 --max-wait 1`.
Reports: `tests/.output/g/r9RhQ5f/`.
The updated-master repetition is in `tests/.output/g/rCTYuLS/`.

Clean-master result:

```text
SUMMARY: 901e836f6eef543b6f9ea8db2c4812b3e52fedd0 | unit="not run" parity="not run" e2e={"passed":52,"failed":2,"flaky":0,"skipped":2} gate_failures=2
SUMMARY: 45b689772c275d58eaa7d1b7b11bc586520f2522 | unit="not run" parity="not run" e2e={"passed":52,"failed":2,"flaky":0,"skipped":2} gate_failures=2
```

## Linux confirmation

The first follow-ups-nine full Linux gate also catches this exact assertion
(`tests/.output/g/r1Jgpn5/`). A clean `origin/master` checkout in this worktree,
at `45b68977`, reproduces it in three of five Linux repetitions. The failing
transforms again finish the follow transition during resize. There are no
other failures in this baseline, and no assertion or quarantine is changed.

Command: `pnpm gate quick tests/e2e/followups4-inspector.spec.ts --linux --only e2e --workers 3 --cpus 4 --memory 12g --repeat 5 --ports 6960 --max-wait 1`.
Report: `tests/.output/g/rgKIM0I/`.

```text
SUMMARY: 45b689772c275d58eaa7d1b7b11bc586520f2522 | unit="not run" parity="not run" e2e={"passed":137,"failed":3,"flaky":0,"skipped":0} gate_failures=3
```
