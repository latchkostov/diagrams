## Toast modal focus and feedback

Toasts that open a modal keep their control mounted, inert and in place while the modal is open,
even when another notification arrives. Closing the modal returns focus to that control before
releasing its ownership. A missing palette opener falls back to the canvas.

Dialog feedback now publishes engagement changes to React, so leaving a hovered toast restarts
its expiry without another notification or render. Toast action and Dismiss buttons cannot submit
the Custom Inject form, including when Undo has become unavailable.

This fixes PR #340's four P1 findings and the related engagement P2 within the existing layering
design. No output formats or parity goldens were changed in this fix round.
