## Parallel-work follow-up fixes (2026-10-17)

- Restored the marketplace description's literal ellipsis to the exact master text. The corruption
  entered in the version-removal JSON rewrite in `e1619068`: UTF-8 bytes were decoded as Windows-1252,
  then serialized as JSON escapes. The rewrite command was not committed; the release script already
  read UTF-8 and no longer writes the manifest. Release writes now specify UTF-8 explicitly, without
  a BOM, and release preflight plus unit checks reject raw or JSON-escaped mojibake in the marketplace,
  skill files, documentation fragments and frozen histories. The full branch diff was audited.
- Sync loads the generated-file policy from the current checkout at each rebase stop and before final
  regeneration. New upstream outputs are classified and staged correctly. Real-index tests cover clean
  and conflicted new outputs, distinct authored merge stages, preserved keys/prose and unresolved
  competing edits.
- Development schema URLs respect Vite's configured base, including `/tools/diagrams/`. Serialization
  happens once per server; restart Vite after editing schema/catalog source modules, which browser HMR
  does not reload in Node. Tests check subpath responses and serialization counts across two servers.
- The production schema browser check compares every response with the complete generated contract,
  rejecting swapped or stale schemas rather than merely checking their broad shape.

Validation: 8,720 unit tests passed, 4 skipped; the touched production E2E spec passed all 7 tests
with two workers, zero failures and zero flakes. Seven deliberate unit regressions and swapped/stale
schema assets each failed their regression checks, then were restored. Build, size, i18n and skill
freshness checks passed. Parity verified 2,196 goldens unchanged (none added, missing or stale), including
all 76 Linux browser cases with two workers. No goldens were re-recorded. Full E2E and the full push
gate are delegated to CI under this task's override; no benchmarks were run.
