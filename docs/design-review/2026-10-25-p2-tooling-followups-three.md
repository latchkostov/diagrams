## P2 tooling and collaboration follow-ups

Reviewed against the UX principles: no controls, layout or interaction changes. Diagnostic subscribers
now receive the final empty-queue state immediately. The CI report distinguishes cancelled tests from
real failures and identifies which complete attempt supplies the shard comparison, keeping the
evidence readable without adding editor chrome.

Rejected combining partial reruns into a purported same-attempt measurement: their wall times need
not share the same execution conditions. Rejected additional lazy-surface changes because #305
already prunes retired generations during registration and retains active output readiness.
