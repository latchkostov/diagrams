## Complete Inspector segment labels (#265)

Merged current master with a signed merge commit and regenerated the skill assets. Inspector segmented choices now fill the value column with 6 px horizontal padding and 11 px text. Long translations wrap naturally instead of being cut off; the English While waiting choices remain on one line at both 1280 and 1440 px. The copy is unchanged.

Regression coverage measures every Inspector segmented control (While waiting, Circuit breaker, retry growth, retry jitter, diagram direction, annotation text size, firewall rule, autoscaling busy-thread units and traffic-mix mode) in English, pseudo-English and Arabic at both widths. The original CSS fails the new text-overflow assertion at 1440 px. The complete native Inspector layout suite passes, including keyboard and accessibility checks.

I18n validation, skill freshness, catalog parity, production build, size and all four bundle benchmark gates pass. Catalog parity compares three goldens: none changed, added or missing. No parity goldens were updated. The requested single Linux Inspector run could not acquire capacity: both attempts exited 75 because another gate held all 12 workers; verification falls back to PR CI as requested.

The broader unit run was stopped after local five-second timeouts in four unchanged simulation/replay files. Targeted clean-master replays reproduce timeout failures in all four files; exact results and follow-up are recorded in [the backlog](../backlog/2026-10-25-timeout-triage.md#evidence-07). No complete unit-suite pass is claimed.
