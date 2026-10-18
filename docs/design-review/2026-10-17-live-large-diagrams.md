## Live view on large diagrams (2026-10-17)

What changes visually, and only above 1,000 nodes and edges on the canvas (`LARGE_LIVE_ELEMENTS` in
`src/live/decorations.ts`; the diagrams people draw by hand are far below it):

- **No fades.** An edge going idle or busy, a node dimmed by a narration focus or a path trace, a node's heat glow and
  the badges' pills and depth bars change at once instead of over 0.3 s. At high traffic hundreds of these ran at
  once, each animated on its own; after Traffic × 10 at 5,000 nodes the screen froze for up to a minute at a 2× to 4×
  CPU throttle.
- **Over-capacity rings hold still.** The heat map's red ring is drawn at its strongest instead of pulsing. It stays the
  most prominent ring on the map (full colour, a halo), so "over capacity" still reads at a glance.

Everywhere, at any size:

- **Busy edges stay lit between messages.** An edge stays marked active for three publishes (about 0.4 s) after its last
  message, instead of flickering idle and back between two messages. It goes idle as soon after that as before. Paused,
  the edges keep the state they had, as the dots do. Nothing a check, a counter or an expectation reads changes: this is
  presentation only.
- **A slow frame doesn't slow the simulation as much.** When the page draws less than ten frames a second, the
  simulation now catches up by up to a second per frame, as far as the engine can afford, so message rates, backlogs and timelines move at the speed they
  show. Coming back to a hidden tab, it resumes where it was, without a jump. Slow motion and the marching edges keep
  their own pace.

No new setting or control: it adapts by itself (UX principles: simple by default). Reduced motion is unchanged (every
transition and animation was already off). Small diagrams look exactly as before; the live e2e specs about active and
idle styling pass unchanged, and `tests/e2e/live-large.spec.ts` checks both sides of the threshold.

Rejected: holding the rising-backlog pulse still on large diagrams: it cut the compositor's layers by five but
doubled the frame time (docs/backlog/2026-10-17-live-large-diagrams.md); the pulse stays. Transitioning only spotlight changes (option b): it keeps the fades on large diagrams for narration and
traces, where a spotlight dims every node at once, the same many-at-once case. A toggle for "reduce effects": the
diagram's size already says when it's needed.
