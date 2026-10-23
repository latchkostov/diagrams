## Hover-card integration

Merge master's sampling, Enter-to-pin and line-gesture controller fixes into the resilience UX follow-up, including #256's admitted-request accounting for narrowed retries. Compact hover summaries retain the fixed 320 × 332 frame without scrolling; the leading problem appears once, and throughput history remains in expanded Outcomes.

Accessibility setup follows the deduplicated summary, with every existing axe rule enabled. The deferred Request-fields keyboard regression includes the advanced pool disclosure in its intended position before Retries.

The latest master also retains export-confirmation readiness in the lazy-download tests: the file's arrival precedes its separately loaded toast, so the tests observe that toast before advancing its expiry clock. A held-confirmation regression covers the ordering.

## Output parity

All 3,111 goldens are unchanged: zero changed, added, missing or stale. No golden was re-recorded.
