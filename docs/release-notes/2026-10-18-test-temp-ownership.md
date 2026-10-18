## PR #170: isolate test scratch ownership across concurrent runs

The teardown guard now checks only the current run's redirected temporary root.
New folders created in system temp by another worktree no longer fail this run;
the existing owned-fixture guard still reports missing skill-fixture cleanup.

Each run records its PID namespace and PID in an ownership marker. Reaping still
requires a directory older than a day and a confirmed dead process, and now also
requires matching, verifiable ownership. Linux identity includes the boot ID and
PID namespace; native Windows and macOS identity includes the platform and host.
Foreign namespaces, unavailable identity, and legacy or corrupt markers are left
alone because their owner cannot safely be declared dead here.

Regressions cover concurrent foreign folders, an old live foreign-namespace run,
unavailable namespace identity, abandoned local runs, and retained live, recent
and unverifiable roots. Docker scratch placement and nested subprocess bounding
are recorded separately in the backlog. No application output or parity golden
changes are intended.
