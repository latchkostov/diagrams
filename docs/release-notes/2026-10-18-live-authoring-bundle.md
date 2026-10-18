## Live authoring loads on demand

The simulation editor, drill presets and fault-step controls now download when their panel opens,
using the existing lazy loader. While downloading, the panel shows Loading and can be closed with
its Close button or Esc; a failed download offers Retry. Playback and authoring behavior are unchanged.

The bundle-only benchmark measures Live's initial static imports at **129,626 B gzip**, down from
**137,385 B**: **7,759 B saved**, with **5,374 B headroom** under the unchanged 135,000 B budget.
No parity goldens change. The split alone provides enough headroom, so latency details and fault
playback remain together with their existing callers.
