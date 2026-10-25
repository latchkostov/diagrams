## Lazy-loading test contracts

This batch changes tests and their helpers only. It adds no controls or chrome. Recording exercises
the existing Start recording, countdown, Stop and Discard flow with real Chromium tab capture.
The marker background belongs only to the browser test and identifies the deferred narration in
the capture stream and encoded clip.

The tests preserve focus ownership, Advanced editing and cancellation after module evaluation.
Fullscreen transitions now wait for their own fit command and camera idle before the next resize;
the existing clipping and exact refit-count assertions stay intact. Ten repetitions passed.

The first attempt of [#291's CI run](https://github.com/latchkostov/diagrams/actions/runs/40145432799/attempts/1)
failed when the second shrink expected clipping. An intermediate unclipped frame is enough for
the old wait to pass while the first fit is still moving; it can then absorb the second pane size.
Waiting for the first fit to finish preserves the second shrink's precondition.

The SVG content check exposed missing narration. It remains a documented fixme for the output
lane instead of changing product behavior here. No production output or parity golden changes.
