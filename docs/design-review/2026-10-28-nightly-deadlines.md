## Nightly deadlines UX review

This batch changes CI scheduling and test infrastructure. It adds no product controls, text,
interaction, layout or simulation behavior, so the chrome budget and user workflows are unchanged.
All existing browser assertions and output goldens remain authoritative. Native reports keep their
OS, project and shard identity; incomplete execution remains explicit rather than appearing green.
