## PR #170: keep standalone Docker parity scratch on a native filesystem

`scripts/parity.mjs` redirects the browser container's temporary files under
`/work/tests/.output/tmp`, which is currently part of the host checkout bind mount.
Mount a native Docker volume there, following `scripts/gate/linux.mjs`, or use
container-local scratch with equivalent cleanup. Chromium profiles, traces and
artifacts should avoid host bind-mount I/O, particularly on Windows and macOS.
Keep this separate from the run-ownership correctness fixes.

## PR #170: bound the nested Vitest subprocess

The worker-pool regression in `src/lib/testTemp.test.ts` uses `spawnSync` without
a subprocess timeout. Its enclosing Vitest timeout cannot interrupt a blocked
worker event loop. Add a child-process timeout and include `result.error` in
failure diagnostics. Add a regression named "terminates a stalled nested runner"
that deliberately stalls a child and verifies termination at the configured
deadline. This remains deferred from the ownership review round.
