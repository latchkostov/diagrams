## Pause the replay before waiting for its caption paint

Nightly 41196683594, Windows shard 7, fails the main-renderer caption capture case before recording begins. Its trace shows the replay already paused at progress 1000 at 820863 ms, before the setup clicks Play/Pause at 821979 ms. That click correctly restarts the finished replay; the following paused assertion then sees playing. The caption wait consumed the interval in which setup intended to pause. This is not a video codec failure.

Preparation now waits for the actual slow-motion control mode, pauses immediately, and then waits for the caption paint. The same playing/paused checks, nonempty caption checks and video pixel comparisons remain, including the assertion that the take stayed paused. No duration, timeout, tolerance, codec or application changes.

A regression holds genuine particle-worker paint reports before starting slow motion. Preparation must reach its paused stage while the caption paint is still unavailable, and finish only after the original reports are released. Restoring the original caption-before-pause ordering must fail that regression. The observer preserves native transfer ownership; no synthetic caption or video pixels are introduced.
