## Current health and retry-lesson guidance

Reviewed against the owner's October 24 decisions and finding 2 of the October 23 UX review. Health answers what needs action now. The compact verdict and Inspector use current conditions; Outcomes names the historical scope. A stable small queue no longer competes with healthy throughput. A closed breaker only says calls succeeding when successful calls are observed and its recent failure window is clear.

## Chrome and disclosure

No top-bar, live-bar or global settings controls were added. The connection keeps three disclosure rows: Retries, Outcomes and Circuit breaker. Outcomes replaces the old Timeouts row and retains cumulative damage and its failure-rate population. Node Outcomes retains losses, failed work, dead-letter transfers and the recent throughput history. Counts never substitute for current state. Attention retains symbols and text alongside color.

## Teaching in place

All four retry comparisons explain what to watch at 1.2 seconds through the existing narration card. Copy names the actual slowdown time and gives each comparison its own observation. The budget card makes its later recovery explicit without promising an accelerated result. The original 60-second comparison and the POST repetition caveat remain honest.

Rejected shortening or silently accelerating the lesson: that would change its authored timing. Rejected treating every queued message or lifetime timeout as an incident: both reproduce the reviewed contradictions. Added no resilience dashboard or additional permanent controls.

## Checks

Production-browser regression coverage exercises recovered hover/Inspector verdicts, historical timeouts in Outcomes, the public retry example in Free play with exactly five messages queued and five of 400 threads busy, all four early narration cards and light/dark axe scans on the expanded hover card. Existing hover and Inspector behavior remains covered, including keyboard pinning, Escape, bounded cards and preserved disclosures. The final verification and golden inventory are reported in the release fragment and PR.
