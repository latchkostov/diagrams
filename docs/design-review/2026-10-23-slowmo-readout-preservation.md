## Slow motion fix round UX review

Playback retains its last published journey clock, caption and trace highlights between UI updates.
Changing pace therefore keeps the replay's readouts coherent. The current playback clock still
drives painting, and paused snapshots remain unchanged by ignored ticks.

No controls, labels, camera behavior or layout changed. Browser wiring stays in the lazy replay
adapter; the pure script owns pacing and frames. Recomputing derived frames on every tick was
rejected because the existing publication cadence already defines when readouts update.
