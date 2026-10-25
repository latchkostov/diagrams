## UX review

Engine-only correction: completed recovery must leave accurate in-flight and held-call
readouts, and subsequent requests must keep progressing. The change fixes ownership
at the admission transition, with no additional controls, text or chrome. Existing
retry policies, sampling scale and failure classification retain their meaning.

Reduced fixtures cover both reported fractional scales and exact checkpoint replay.
Readout clamping, post-run counter resets and relaxed invariants were rejected because
they would hide live ownership errors without releasing the underlying work.
