## Completed connection owns the next step

Nightly 41245495563, macOS shard 8, completes request-vs-message's connection step while the keyboard driver is still applying optional port choices. The trace shows the next, Live step on screen, with the driver attempting the previous step's editing shortcut. The editor correctly refuses that operation during the handoff.

The compound connection driver now yields after real step completion, before its optional port choices. It still requires the next step and the final lesson completion. A real-browser regression creates the connection with the keyboard and requires the handoff before optional port editing. Windows: one pass with the fix; temporarily restoring the original driver fails that regression. No product change, synthetic completion, skip, retry, deadline, tolerance or budget increase.

A broader early exit after every action was rejected: naming and dialog steps still need their remaining Enter or Close actions while completion is pending. The first Linux cohort exposed two such failures, which are not passing verification.

Round four's final verification fragment records the Linux repetitions and dispatched native results. Existing keyboard focus failures remain a separate investigation.
