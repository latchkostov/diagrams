## Appended-row quarantine UX review (PR #300)

Restore master's bounded appended-row behavior without adding controls or growing the chrome.
Keep the existing Add/rekey focus behavior covered by its unchanged browser test. Visibility across
rename Undo, reused names, multiple appends and room projections remains an explicit unresolved
requirement, with identity-only tests preserved in quarantine.

The retained picker/search accessibility and card Escape fixes remain independent of row identity.
Search misses still use misleading empty-flow wording; that wording and missing zero-match coverage
are recorded as OPEN follow-ups, alongside vocabulary work reduction. A stable rule-id design needs
an owner decision before a further implementation round.
