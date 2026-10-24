# Scoped review rounds

```sh
pnpm review --brief /path/to/brief.md --pr 123
pnpm review --pr 123                # next delta round for that PR, including on detached HEAD
pnpm review --branch feature/name   # explicit state identity without a PR
pnpm review --since <reviewed-sha>  # explicit first-parent starting point
ANGLES="correctness security" pnpm review --brief brief.md
pnpm review --allow-round-4         # explicit owner-approved exception to the cap
pnpm review --pr 123 --full         # all seven lenses on the whole PR, no state changes
pnpm review --audit                 # explicit repository-wide audit, no state changes
pnpm review --pr 123 --reset-state  # restart at round one, all lenses
```

`--brief` includes the full brief so its acceptance criteria are not lost. `--pr` fetches the PR title
and description plus `headRefName` and `baseRefOid` with authenticated `gh`; either or both may be supplied
in any order. A PR review works on a detached HEAD and uses the PR's branch and base metadata, without
requiring a local branch. Without `--pr`, use the current branch or supply `--branch <name>` on a detached
checkout. A supplied `--branch` must match the PR branch when both are given. Intent persists
to subsequent rounds; supplying fresh context replaces the saved context. Failures to read a brief
or fetch a description stop before reviewers start. `CODEX_MODEL` and `CODEX_EFFORT` retain their
existing overrides.

Round one reviews `base=$(git merge-base <PR baseRefOid or origin/master> HEAD)`, using `base...HEAD`. Subsequent
rounds default to `--since <last reviewed SHA>`. Delta patches are collected from first-parent,
non-merge commits only, plus each merge's diff against its first parent restricted to files touched
by the PR's own non-merge commits. This retains conflict resolutions without reviewing master-only
files or commits. Changed-line numbers are relocated through subsequent commits before triage.
Deleted hunks use their adjacent HEAD line as an anchor. Reviewers use the recorded patch, never an
unscoped two-dot range. Surrounding source is context only; the reviewed scope is committed HEAD.

Each run writes `.reviews/<stamp>/scope.patch`, `plan.json`, the previous report, prompt, raw lens
JSON/logs, `triage.json` and `REPORT.md`. The round, file count and exact next-round command precede
the file list at the top of the report. The
deterministic consolidator clusters matching normalized paths within 12 lines and title-token
Jaccard similarity of at least 0.5. Every member must match every other member, preventing accidental
chains. Explicit `previousId` takes precedence over fuzzy matches; different explicit identities never
cluster together. It keeps the highest severity, lists every contributing lens and retains each member's
evidence. Different wording can remain separate; the raw evidence supports human triage. No extra
model session is needed. Out-of-scope findings are recorded as excluded in `triage.json`.

PR state lives at `.reviews/state/pr-<number>.json`, independent of branch smoke runs or checkout mode.
Without `--pr`, state lives at `.reviews/state/<branch>.json` (branch slashes form subdirectories), including round,
last reviewed SHA, open P1 IDs, issue evidence, intent and report path. P0 blockers are also carried
in that list. An incomplete/malformed lens or missing assessment never advances state. Do not delete
state to bypass the cap. `--reset-state` explicitly restarts a review with no previous assessments;
the old state is replaced only after all lenses complete successfully. Concurrent completions compare
and replace the snapshot under an OS-released lock and atomically rename the new JSON; a stale completion
fails instead of losing another round. After a rebase, use `--since` with an explicitly reviewed first-parent
ancestor; otherwise an unreachable saved SHA fails clearly. Keep reports while their state exists.

Round two and later require correctness and every lens contributing to an open P1. `ANGLES=`
overrides round one's lenses for branch-only runs and adds to the required delta lenses on later rounds.
A PR's first round, `--full` and `--audit` always include all seven lenses, even with `ANGLES` set. Every reviewer
assesses every previous open P1 as fixed or open with evidence. A disagreement keeps it open. New
findings on unchanged lines are capped at P2 by the consolidator; previous issues keep their IDs.
Use `previousId` for an old issue even when its fix moved it far from the old line.

Round three ends with `QUARANTINE-OR-MERGE`, with a suggested dated backlog fragment per remaining
P1, instead of fix instructions. It does not modify tests, quarantine product behavior or merge.
Round four is refused unless the owner explicitly approves `--allow-round-4`; that flag also lifts
the decision-block policy for the approved run. `--full` reviews the whole PR merge-base diff, rather
than the next fix delta. Only explicit `--audit` reviews all tracked repository files (also allowed on
detached HEAD without a PR). Neither mode creates, consumes or resets state. `--full`, `--audit` and
`--since` are mutually exclusive; `--reset-state` cannot be combined with any of them.

Tests can set `REVIEW_PR_RESOLVER` to an absolute Node module path. It receives the PR number as its
first argument and returns the same JSON metadata on stdout; production uses `gh` when it is unset.

Reviewer tests must use explicit unit test paths:

```sh
pnpm gate quick src/lib/reviewLoop.test.ts --only unit --workers 1 --max-wait 1
```

The gate invokes `vitest run <files>` under its shared worker budget. No directories/globs, full
suites, direct Vitest, benchmarks or browser suites in reviewer sessions. Exit 75 means busy; record
the missing verification and continue the review without bypassing admission.
