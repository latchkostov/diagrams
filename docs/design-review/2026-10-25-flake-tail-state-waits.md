## UX review: recent flake candidates

This test-only change adds no controls, copy, menus or layout. Recording still uses the real browser capture and encoder; the test waits for a take that can be saved before pressing Stop. The existing cancellation behavior before encoder startup remains covered by the mutation check, and real narration/video pixel coverage remains intact.

Rejected: adding sleeps, extending timeouts, enabling retries, weakening exact label/focus/download assertions, or waiting for Inspector field focus before typing. The last option would conceal a product key-priority race while the name field is unavailable. The [backlog investigation](../backlog/2026-10-25-held-inspector-escape-focus.md) preserves that contract and records the journal and repeat counts. No product fix is attempted in lane C.

The complete fresh CI failure table is retained in the [60-run evidence report](2026-10-25-flake-tail-ci-evidence.md). Historical passing reruns do not establish a fix. Simulation and export goldens stay unchanged; no golden update is needed for a test-only wait.
