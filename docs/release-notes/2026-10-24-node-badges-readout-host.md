## Live badge rendering without an interaction layer

Live badges skip the edge subscription when no canvas interaction layer is available. This fixes
two NodeBadges regressions without changing current-condition health windows, Since restart
outcomes, or idle Request pill behavior. Both existing unit tests remain unchanged.

No parity goldens changed in this fix. Verification is limited to NodeBadges and the production-build
hover-card suite, plus pre-commit static checks, as requested for this fix round.
