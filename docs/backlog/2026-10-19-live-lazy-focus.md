## Live lazy-loading focus follow-ups (PR #189 review)

- Keep a synchronous node-detail reading-region shell and accessible description while its contents download. Preserve keyboard focus across the lazy handoff and avoid changing the tooltip's placement or scroll behavior. Cover a held NodeDetails request, Tab into the reading region, and focus retention on completion.
- Add held/rejected CapacityPanel download tests for Close, Escape, Retry and focus restoration to the Inputs opener. Existing loaded-panel tests do not exercise the pending/error frame or the captured opener's handoff.

These require coordinating persistent shell ownership with lazy content and browser focus/placement behavior; they are deferred from the bounded replay recovery fix. Use production bundles, data-testid selectors and held requests, then repeat affected and neighboring focus/viewport specs under Linux load.
