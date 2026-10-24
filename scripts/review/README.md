# Scoped review rounds

```sh
pnpm review --brief /path/to/brief.md --pr 123
pnpm review                         # next delta round, using saved state and intent
pnpm review --since <reviewed-sha>  # explicit first-parent starting point
ANGLES="correctness security" pnpm review --brief brief.md
pnpm review --allow-round-4         # explicit owner-approved exception to the cap
pnpm review --full                  # standalone audit, no branch-state changes
```

`--brief` includes the full brief so its acceptance criteria are not lost. `--pr` fetches the PR title
and description with authenticated `gh`; either or both may be supplied in any order. Intent persists
to subsequent rounds; supplying fresh context replaces the saved context. Failures to read a brief
or fetch a description stop before reviewers start. `CODEX_MODEL` and `CODEX_EFFORT` retain their
existing overrides.

Round one reviews `base=$(git merge-base origin/master HEAD)`, using `base...HEAD`. Subsequent
rounds default to `--since <last reviewed SHA>`. Delta patches are collected from first-parent,
non-merge commits only, plus each merge's diff against its first parent restricted to files touched
by the PR's own non-merge commits. This retains conflict resolutions without reviewing master-only
files or commits. Changed-line numbers are relocated through subsequent commits before triage.
Deleted hunks use their adjacent HEAD line as an anchor. Reviewers use the recorded patch, never an
unscoped two-dot range. Surrounding source is context only; the reviewed scope is committed HEAD.

Each run writes `.reviews/<stamp>/scope.patch`, `plan.json`, the previous report, prompt, raw lens
JSON/logs, `triage.json` and `REPORT.md`. The exact file list is at the top of the report. The
deterministic consolidator clusters matching normalized paths within 12 lines and title-token
Jaccard similarity of at least 0.5. Every member must match every other member, preventing accidental
chains. It keeps the highest severity, lists every contributing lens and retains each member's
evidence. Different wording can remain separate; the raw evidence supports human triage. No extra
model session is needed. Out-of-scope findings are recorded as excluded in `triage.json`.

State lives at `.reviews/state/<branch>.json` (branch slashes form subdirectories), including round,
last reviewed SHA, open P1 IDs, issue evidence, intent and report path. P0 blockers are also carried
in that list. An incomplete/malformed lens or missing assessment never advances state. Do not delete
state to bypass the cap. After a rebase, use `--since` with an explicitly reviewed first-parent
ancestor; otherwise an unreachable saved SHA fails clearly. Keep reports while their state exists.

Round two and later require correctness and every lens contributing to an open P1. `ANGLES=`
overrides round one's lenses and adds to the required delta lenses on later rounds. Every reviewer
assesses every previous open P1 as fixed or open with evidence. A disagreement keeps it open. New
findings on unchanged lines are capped at P2 by the consolidator; previous issues keep their IDs.
Use `previousId` for an old issue even when its fix moved it far from the old line.

Round three ends with `QUARANTINE-OR-MERGE`, with a suggested dated backlog fragment per remaining
P1, instead of fix instructions. It does not modify tests, quarantine product behavior or merge.
Round four is refused unless the owner explicitly approves `--allow-round-4`; that flag also lifts
the decision-block policy for the approved run. A standalone `--full` audit does not consume or reset
branch rounds.

Reviewer tests must use explicit unit test paths:

```sh
pnpm gate quick src/lib/reviewLoop.test.ts --only unit --workers 1 --max-wait 1
```

The gate invokes `vitest run <files>` under its shared worker budget. No directories/globs, full
suites, direct Vitest, benchmarks or browser suites in reviewer sessions. Exit 75 means busy; record
the missing verification and continue the review without bypassing admission.
