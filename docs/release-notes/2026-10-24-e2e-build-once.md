## CI builds E2E variants once

Pull-request CI shares one set of production E2E builds across six shards and uses
the lockfile-pinned Playwright image for Chromium and its system libraries. Shards
still serve only their selected self-host variants, and required check names,
duration artifacts, blob reports and failure traces keep their existing contracts.

All 141 entries in the committed duration map are refreshed from the successful
[baseline CI run](https://github.com/latchkostov/diagrams/actions/runs/40126756841).
Complete estimates use whole-file greedy balancing; missing or invalid estimates
fall back to a deterministic count split with a warning. The updater now accepts
an artifact download directory on Windows as well as POSIX shells.

The [PR](https://github.com/latchkostov/diagrams/pull/284) records before/after measurements from its own CI runs, including every
shard and the critical path with shared-build and queue time included. No output
goldens changed: all 3,147 compare unchanged.
