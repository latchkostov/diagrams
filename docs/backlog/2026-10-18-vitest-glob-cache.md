## Invalidate persistent transforms when a public corpus grows

After syncing the five public showcases, the shared Linux Vitest module cache retained old metadata/glob transforms:
the registry contained 32 examples while cached glob results contained 27. Eight example/gallery assertions failed.
Running the two affected suites with `--fsModuleCache=false` passed all 37 checks. Vitest's `--clearCache` cleared the
stale transforms without changing assertions, examples or goldens.

Follow up on directory/glob invalidation or revision-scoped transform caches, especially when the gate reuses its
dependency volume across worktrees. A regression should run two fresh Vitest processes around adding a public JSON
input, with the importing test and metadata module unchanged. Do not re-record outputs to accommodate cached data.
