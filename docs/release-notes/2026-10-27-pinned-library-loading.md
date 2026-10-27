## Pinned library during loading and recovery

The pinned stencil library keeps its Close library (Unpin) control while its contents download or a download fails. Closing it immediately returns the space to the canvas. On phones its loading and failed states keep the same overlay geometry as the loaded library, avoiding a narrowed canvas and a jump on completion. Pin open also works before the contents arrive.

Regression coverage holds and fails the stencil chunk on desktop and phone, checks dismissal and stable geometry, and exercises recovery. Additional coverage checks successful search-focus handoff without Retry and phone transport controls while the overflow contents are unavailable.

No parity golden is changed or re-recorded. Download budgets and reserve thresholds are unchanged.
