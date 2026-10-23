## Canvas headroom UX review

No controls or chrome were added. Node identity and naming load independently of simulation
settings. The shared lazy loader keeps recovery outside the failed chunk.
Holding settings must preserve the node's move cursor, keyboard nudge, label focus and typing,
and successful image export. Arrival must preserve focus in the name field. Failure must leave
naming usable and offer Retry without taking focus. The new production chunk-hold regressions
cover those contracts.

Slow-motion readouts load only during replay. The loading status, play/pause, speed,
screen-reader captions and Esc remain independent of the readout chunk. Its hold test
checks pause, image export, retained focus and exit.

The broader node-panel split was rejected: it deferred naming unnecessarily and exceeded the
live-session bundle budget. Checks reuses one topology while retaining independent configured
message graphs, so its findings and simulation outputs stay the same.
