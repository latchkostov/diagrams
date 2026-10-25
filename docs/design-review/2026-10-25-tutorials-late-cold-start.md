## Cold-start timing review

The existing narration pauses the tutorial's run while instances are starting, preserving the real readout until the learner hovers. This avoids requiring learners to discover Restart after missing a brief observation window. No new controls or runner behavior are needed, and the shared example keeps its original playback.

The regression leaves the readout closed for longer than the saved run's duration, then completes through the instructed hover. The browser path checks the paused narration and completion through the same readout.
