## Test scratch stays on the repository drive

Unit tests now remove their skill CLI fixture, skill-release failure fixture and empty deployment-build
environment directory. Parity's skill fixture already had a `finally`; it now retries deletion when
Windows briefly locks a file. All other test scratch owners found in the temp-directory audit, plus
the sync and offline-package scripts, also retry recursive cleanup.
Skill fixtures and CLI work now start inside hooks/tests, so filtering out the whole suite creates no scratch
files and needs no skipped cleanup hook.

Vitest global setup creates `tests/.output/tmp/vitest-<pid>-<time>-<random>` before workers start.
`TMP`, `TEMP` and `TMPDIR` point there in both worker pools and their child processes. Parity and gate
Node commands get their own run directories under the same parent; browsers retain their repo-drive
profiles, separate from Node scratch in the Linux volume. Teardown deletes the run tree on success
or failure. Abandoned run directories older than a day are reaped at the next start, covering interrupted
runs while preserving a live watch process's scratch tree.
The shared gate admission directory remains shared across checkouts.

A teardown guard snapshots system-temp directory names and fails on new `livediagrams-*` or `parity-*`
folders. Vitest also reports known fixture directories missing their own cleanup before deleting its
run tree. Regression tests exercise both forks and threads, child-process inheritance, concurrent run
isolation, stale cleanup, leak detection and teardown after a failed gate command.

No application output or parity golden changes. Skill parity normalizes the new repo-relative temp
paths back to the existing `<tmp>` marker, keeping its output contracts unchanged. Redirecting scratch
alone would still accumulate files on the repository drive, so it is paired with explicit owner cleanup,
teardown and stale-run recovery. No application controls or UX changes are needed.
