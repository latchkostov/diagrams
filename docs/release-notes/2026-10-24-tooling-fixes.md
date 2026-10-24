## Flake classification and review continuity

The CI classifier checks every reported error before accepting a timeout signature. It reads jobs
for the current run attempt, accepts only unique report uploads within that job's timestamps, and
rejects a run attempt that changes during collection. Machine unit reports retain nested suite hook
errors. Operation probes apply exclusions to repository-relative paths, so checkout directory names
cannot disable instrumentation.

Review consolidation joins findings from different lenses at the same file and line even when titles
differ. Unknown previous issue IDs are logged and treated as new findings, preserving severity caps
and mandatory active assessments. PR identity no longer replaces saved intent; `--brief` and
`--refresh-intent` explicitly replace it. Prompts and reports distinguish the saved fix delta from
whole-PR context. The ledger records the reported light background tint failure from PR #268.

Application output is unaffected. No parity goldens changed; parity was not run for this scripts-only
fix round, which uses the related unit tests.
