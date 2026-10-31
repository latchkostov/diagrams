## Deadline callouts need the real verification reply

Nightly 41196683594, Windows shard 4, fails all three verified deadline callout cases. The false-override trace reaches simulation time 10990 and pauses, then publishes Add a timeout at 466261 ms, after the assertion's 7000 ms deadline. Other cases also reach more than ten seconds of simulation time. Advancing the fake page clock does not finish the worker's real replay.

The deadline fixture now uses the existing thread-verification observer. Its original 11000 ms of fake playback, saved overrides, exact deadline and non-blocking policy, keyboard application and Undo assertions are unchanged. It additionally confirms the paused state and that playback crossed ten seconds, then waits for the genuine worker response before starting the rendered action assertions. No timeout or budget increases.

A held-response regression pauses at that setup stage and proves it cannot finish before the real response. Releasing the original request must yield the original Add a timeout action. The observer preserves both native transfer overloads. This is the same worker/readiness boundary already verified in the owner and lazy-callout fixtures, now applied to the remaining deadline consumers.
