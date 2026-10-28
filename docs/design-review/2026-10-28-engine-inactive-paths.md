## Inactive engine paths UX review

Reviewed against the simple-by-default and chrome-budget rules. This change adds no UI, controls,
text, shortcuts or settings. Existing Live, Run simulations, resource edits, restarts and seeks
retain their behavior; only inactive engine bookkeeping is skipped. Regression tests exercise
resource and revision transitions, and existing simulation/output parity guards remain unchanged.
No showcase example is needed for a behavior-preserving engine optimization.
