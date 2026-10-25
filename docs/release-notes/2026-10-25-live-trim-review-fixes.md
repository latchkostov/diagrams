## Replay loading preserves focus, shortcuts and recording intent

Starting slow motion keeps the trace card and its focused control mounted. Pending replay
keys are reserved synchronously through the interaction controller, below open panels,
dialogs and naming; the reservation delegates to the replay handler after loading.
An Inputs or Simulations panel closes on its own Escape without cancelling the replay.

Recording a requested replay requires an actual script. If loading leaves it waiting for
a message, recording returns to setup with an explanation instead of making an empty take.
First replay intent also survives development Strict Mode, and replay commands retain
their identity across ordinary Live publications.

Held-chunk regressions compare these transitions with the loaded runtime. The simulation
switch regression now waits for late runtime evaluation and camera settling before
asserting cancellation. No output goldens changed; no goldens were re-recorded.
