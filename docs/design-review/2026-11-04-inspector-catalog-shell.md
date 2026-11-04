## Simulation catalog loading and recovery

Keep the current disclosures and their compact summaries. Opening the Inspector must show progress
when Simulation translations are slow, and Retry must remain available after a failure without
blocking the name field. Waiting in the parent settings loader prevented the child loading shell
from mounting, so opening another disclosure could not repair the missing feedback.

Move only the three settings-shell messages into core and retain catalog readiness in the Simulation
loader. This uses the existing loading and error surfaces, adds no controls and preserves all browser
assertions for loading, Retry, focus, editable names and language-switch recovery. A unit regression
also pins the parent loader's independence and its labels' core-catalog ownership.
