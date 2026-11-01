## Cause

Nightly 41267020590's Linux Build repetition fails the Sequence download/Retry tutorial case: Escape leaves the Sequence dialog open, and its SVG intercepts the following Done click. The file completes independently of Toaster's requestAnimationFrame that returns focus to the SVG download invoker. Escape belongs to the dialog panel; sending it while the dismissed Retry has left focus on the body misses that handler.

The fixture now acknowledges the SVG button's actual focus before returning from Retry preparation. The existing case holds the real clock at Retry, observes the actual download and toast removal, verifies that preparation has not finished, then releases the return frame. All exact SVG bytes, trace identity, Escape, tutorial completion and unsaved-sandbox assertions remain.

## Verification

Two constrained native Windows executions pass. Temporarily removing the focus acknowledgement makes the held-return assertion fail. The initial regression candidate checked its flag within the same promise turn and incorrectly passed that negative; acknowledging actual toast removal before checking makes the regression discriminating. No product code, key, deadline, tolerance, retry, skip or quarantine changes.

The full tutorials spec runs twice in the pinned Linux container. The fresh product-fix parity check immediately preceding this test-only change has all 3,178 goldens unchanged; build, size and all 30 startup/reserve heavy cases pass. Final static checks and the dispatched inventories are recorded in PR #411.
