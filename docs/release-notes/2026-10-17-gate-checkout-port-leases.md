## Gate checkout and port leases (PR #152)

Concurrent gates now reserve their checkout and five-port range with their worker slots. Gates in
the same canonical checkout wait, including junction/symlink aliases, protecting shared E2E build
and parity outputs. Different worktrees can overlap; automatic and explicit port reservations
exclude overlapping ranges before any server starts. Process death releases all three leases.
Bounded waits and cancellation cover admission, including a blocked mutex.

The first live participant establishes host capacity until the live queue drains. Later constrained
processes keep their own execution limits without reducing capacity under an earlier FIFO head.
An incompatible oversized request fails before enqueueing instead of blocking the queue.

Regression coverage includes two-process admission, checkout aliases, automatic/explicit and unaligned
port overlaps, dead-owner reclamation, differing capacity reports, deadline expiry while actually
blocked on the mutex, and a bounded synchronous subprocess. Each correction is checked by temporarily
removing it. Full output isolation was rejected because one checkout lease protects all existing
shared outputs with less complexity. No output goldens change.

Local validation: 9,727 unit tests passed (four skipped), and the targeted quick gate passed 157
tests. Full parity passed all 2,196 goldens unchanged, including 77 Linux browser cases. Build and
entry size passed (107.1 kB gzip against 123.5 kB). Eight temporary regressions were rejected.
The demo runs two native quick gates concurrently in separate scratch worktrees using automatically
reserved ranges 6400–6404 and 6405–6409, then two in one checkout using 6660–6664 and 6670–6674,
where the second waits. All four gates pass their three production-build brand checks with one worker,
zero failures and zero flakes.
Scratch checkouts and reports stay under this checkout's ignored output directory.

Initial demo setup failed pnpm's workspace validation with shared dependency junctions; independent
frozen installs fixed it. A later disk preflight correctly refused the crowded OS temp drive. The
successful rerun uses repository-drive temporary files through the real gate API, explicitly retaining
the original shared host-budget directory, admission mutex and all resource limits. One browser demo
attempt used port 6665, which Chromium rejects as unsafe (one passed, two failed); correcting the demo's
port to 6670 passes without changing any test or browser setting. No guard is disabled.
The complete push gate remains PR CI, as requested for this task.
