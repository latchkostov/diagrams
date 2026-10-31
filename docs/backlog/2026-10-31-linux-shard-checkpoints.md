## Interrupted Linux shard reports

A Linux Nightly shard that reached its existing composite-action deadline could lose the final Playwright JSON entirely. CI and Nightly Linux runs now use the existing atomic checkpoint reporter, seeded before builds. An always-run step outside the composite action collects either the final report or its checkpoint before durations and artifact upload. Interrupted results retain passed/failed counts and name both running and not-started cases. Budgets, deadlines, retries, shard counts and coverage do not change.

Targeted harness units pass, including missing/truncated final JSON and partial-final collection. Temporarily restoring the former CI wiring makes the deadline-wiring regression fail. Existing killed-process coverage continues to pass. No parity golden changes are expected.
