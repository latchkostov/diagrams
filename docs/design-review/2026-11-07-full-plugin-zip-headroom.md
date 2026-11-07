## Full plugin packaging review

The read-only viewer cannot open the inspector. Its inspector layout rules are unreachable; shared
readout rules remain at the same import position through `readout.css`. The editor keeps its existing
stylesheet. No controls, vocabulary, placement or interaction change.

Retain the shared readout styling and all plugin behavior. Reject budget increases and removing
layout or ID repair to recover bytes: excluding unreachable styles provides sufficient margin.
