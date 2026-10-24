## Review loop: detached checkouts and explicit scope

PR reviews now resolve their branch and base through GitHub and save state by PR number, so detached
review checkouts work and branch smoke runs cannot consume the PR's first round. The first PR round
always uses all seven lenses. `--branch` supplies an identity without a PR, and `--reset-state` restarts
the review only after successful completion.

`--full` now reviews the whole PR diff with all lenses. Repository-wide reviews require explicit
`--audit`. Neither standalone mode creates or advances state. Reports lead with round, file count
and the exact next-round command. State comparison and replacement share a lock and atomic rename;
explicit issue identities take precedence over fuzzy matching. Reviewer disagreements keep P1s open.

All 3,146 output parity goldens are unchanged, including all 107 Linux browser checks. No goldens
are re-recorded.
