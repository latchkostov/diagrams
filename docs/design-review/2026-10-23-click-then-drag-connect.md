## Click-started connection replacement

The designer review checked the interaction diff against the direct manipulation and Escape
contracts. The fix restores continuous line and target feedback while the pointer is held,
preserves the chosen starting side, and opens no quick-add before release. No controls, labels,
settings or persistent chrome are added.

Escape closes the foreground app dialog first; a subsequent Escape can cancel the canvas gesture.
The browser regression uses Share because the canvas shortcuts dialog already supersedes a
gesture when it opens. Same-dot and other-dot replacements, ordinary cancellation and settled
wheel zoom retain their existing assertions. Review was code-based; production browser tests
verify the interaction behavior.
