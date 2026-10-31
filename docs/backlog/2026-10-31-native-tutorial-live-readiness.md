## Tutorial playback waits for the Live session

Windows in [41167179188](https://github.com/latchkostov/diagrams/actions/runs/41167179188) fails dead-letters while selecting live-sim-picker. Its trace shows the Live toggle already pressed, but the session's picker is absent. Recipe playback had awaited the click alone, although Live mounts from a separate lazy chunk.

The solution driver now uses the existing waitForLiveSession signal after requesting Live. It observes aria-busy becoming false and then asserts the actual controls, before sending the next recipe input. It does not alter application behavior, the select assertion, action timeout or whole-test backstop.

A deterministic Windows regression holds the LiveSession chunk while playing the click. Without the fix the driver returns while aria-busy is still true (**1 failed**); with the fix it stays pending until release and then finds the picker. Native Windows also replays the original dead-letters, backlog-lag, partitions and dependencies-2 solutions twice with three workers and four-CPU affinity. Linux repetitions and the final Nightly results are recorded in the verification fragment and PR.

No output golden changes are intended or re-recorded. Passing locally does not establish that other verifier, replay or recording failures share this mechanism.
