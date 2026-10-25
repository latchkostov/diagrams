## Replay loading and keyboard parity

A message journey that is still downloading now explicitly reports Loading and suppresses
older edge highlights and narration until its own path is ready. Native disclosure controls
keep Enter during loading and playback. A replay waiting for its first message releases
Space and Enter to ordinary Live play/pause and readout pinning, while retaining Escape.

The shell and replay import one small keyboard policy; journey construction and replay
execution remain downloaded on demand. Held-download regressions cover all four final P1
findings, including seeking the normal simulation timeline after a normal trace starts
loading, and preserving its requested time and trace through release.

No output goldens changed or were re-recorded. This targeted fix round does not rerun the
full parity suite. Live additional closure headroom measures 8,581 B against the unchanged
135,000 B budget (fixed build identity used by the trim analysis).
