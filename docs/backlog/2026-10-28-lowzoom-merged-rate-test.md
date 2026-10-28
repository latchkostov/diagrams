## Strengthen merged traffic regression

Review #378 finding R-1b51e64d66: add a merged-rate assertion using two shared-lane edges at 60 messages/s and an unrelated edge at 60 messages/s. Expect bucket 3 for the shared total and bucket 2 for the unrelated edge, retaining sampling-scale checks. The current 1,000 messages/s fixture reaches bucket 4 both separately and together, so it cannot detect missing aggregation.

Deferred from the final focus-only fix round to keep its scope minimal.
