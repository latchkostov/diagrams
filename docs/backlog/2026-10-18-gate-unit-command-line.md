## `pnpm gate quick` unit step fails on Windows for branches that change many files

`scripts/gate/logic.mjs` runs `vitest related --run …changed` with every changed path on the command line. A branch
that adds, changes or removes a few hundred parity goldens (the gallery cleanup changed 416) exceeds the Windows
command-line limit: the step prints "The command line is too long", writes no `results.json` and reports
`FAIL: unit (0.1s)` with `unit="not run"`. The same unit suite passes when run directly with `pnpm test`.

Possible fix: drop golden and other non-source paths from the related list, or pass them through a file or
`--changed <base>` instead of argv.
