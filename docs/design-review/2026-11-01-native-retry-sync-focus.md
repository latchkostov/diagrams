## Keyboard continuity

The existing Retry action must immediately return the keyboard to a surviving control. Pausing animation frames proves that Tab and Escape still act on the intended surface. The tests retain exact targets and SVG content checks, replacing an obsolete requirement to wait for a frame with a stronger check that the next keyboard action works without one.

No controls, copy or layout change. Worker protocol cleanup keeps font drawing subject to the existing visibility loop; unchanged paused views receive one fresh paint when fonts complete. No timeout, retry, tolerance, skip or golden update is introduced.
