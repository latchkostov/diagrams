## Retry focus after the master sync

PR #411's Retry regressions assumed the keyboard returned on a later animation frame. Master's #413 returns it synchronously. CI run 41284874994's logs and traces show both exact focus assertions succeeding before the obsolete pending-state assertions fail; the same two failures reproduce in the pinned Linux container.

Keep the actual focus acknowledgements in the helpers. Require presence and trace Retry to return to the example picker while the clock is paused, then exercise Tab and Shift+Tab. Require Sequence Retry to return to its SVG button and accept Escape with no intervening animation frame. Preserve the downloaded SVG bytes, trace identity, tutorial completion and unsaved-sandbox checks. No application toast change or native fix is reverted.

Remove the unused spontaneous worker repaint message (R-689cfb0405), its receiver path and retained frame data. Font completion still invalidates through the main loop. A real-worker regression now checks an unchanged paused view: no independent draw at font completion, exactly one draw on the next eligible frame, then no further draw (R-bbac277e0e).

No output changes are intended and no parity goldens are changed. This fix round uses the requested targeted checks; PR CI runs full parity.

## Regression evidence

The three focused Linux repetitions pass all nine executions with zero flakes. Temporarily deferring the toast's focus return to an animation frame makes all three focused cases fail on actual focus readiness; restoring synchronous return passes. All 38 renderer, worker and protocol units pass. Temporarily removing worker font invalidation makes the unchanged-paused-view regression fail on its missing draw.

The complete tutorials, lazy surfaces, toast interaction, toast loading, lazy loading and lazy Retry trim specs pass in the pinned Linux container: 275 passed, zero failed, zero flaky, zero skipped. Both production test builds pass; the gate stops its servers and removes its container.
