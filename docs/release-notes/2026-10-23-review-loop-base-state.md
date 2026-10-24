## PR review preparation and continuation

PR reviews fetch a base commit missing from the local checkout before computing their scope. If the
fetch cannot supply it, preparation stops with the PR number, commit and recovery instruction.
Branch review state now uses `branch-<name>.json`, separate from `pr-<number>.json`, so a smoke review
on a branch named `pr-123` cannot consume PR 123's rounds. Existing PR state paths stay the same;
branch reviews start in the new namespace. Continuation examples keep the PR number for both
`--since` and the explicit fourth-round exception.

No diagram output or parity golden changes are intended.
