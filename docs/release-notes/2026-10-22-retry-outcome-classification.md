## Retry outcomes survive every reply path

PR #236 review round: managed API quota and concurrency refusals now reach the caller as throttled (429), and API or boundary outages reach it as transient (503). Downstream deadlines remain transient 504 replies; the caller's own deadline is a timeout. Local call-depth and open-call safeguards remain terminal, including through intermediate callers. One exhaustive outcome resolver supplies retry classes, caller codes and future breaker accounting.

Turning retries off and back on preserves custom backoff, conditions, jitter, idempotency and budget settings, including policies kept off during an upgrade. Capacity estimates inherit the selected endpoint's error rate using playback's resolver. Stable retry demand reuses the waiting plan and its compiled graph instead of rebuilding it on every solver iteration.

No parity goldens were changed or re-recorded, including every `w2-*` golden. Bundle budgets and plugin version are unchanged.
