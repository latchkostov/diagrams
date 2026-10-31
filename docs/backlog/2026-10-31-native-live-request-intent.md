## The pressed attribute can lag the requested transition

The preliminary macOS Nightly 41182626886 exposes another boundary in the held Live-session regression: click resolves before React publishes `aria-pressed=true`. Reading that attribute after the click can therefore skip the readiness wait even though the requested session is still downloading. The trace retains `aria-busy=true` while the helper has already returned.

The recipe driver now captures whether the click requests entry into Live before dispatching it, then waits for that requested session. Exit clicks retain their existing behavior. The held-download regression deterministically supplies the observed false pressed-state snapshot; it still requires the real busy surface and the mounted picker after release.

On Windows, a temporary copy of the same regression with the old post-click condition fails (**1 failed**); the repaired helper passes twice (**2 passed**). The temporary spec is removed after the negative run so the concurrent Linux tutorial process reads only its intended source. The original affected lesson cohort also runs twice, with the complete tutorial spec covered by the post-sync Linux gate. No application, session, timeout, tolerance or oracle changes are introduced.
