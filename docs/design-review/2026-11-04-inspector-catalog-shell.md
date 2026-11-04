## Simulation catalog loading and recovery

Keep the current disclosures and their compact summaries. Opening the Inspector must show progress
when Simulation translations are slow, and Retry must remain available after a failure without
blocking the name field. Waiting in the parent settings loader prevented the child loading shell
from mounting, so opening another disclosure could not repair the missing feedback.

Give the parent settings boundary the existing Simulation loading and error feedback while retaining
its catalog readiness and Retry lifecycle. This adds no controls and preserves all browser assertions
for loading, Retry, focus, editable names and language-switch recovery. A unit regression also checks
that loading feedback renders before the settings arrive, without needing editor props.

Moving the rule summaries to core was rejected: it exceeded the Arabic core catalog's unchanged
38,000-byte gzip budget. The summaries remain optional, with the existing bucket assertions intact.
