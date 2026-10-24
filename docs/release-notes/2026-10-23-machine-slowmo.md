## Slow-motion lifecycle runs through a shared machine

Slow motion now makes capture, playback, pause, seeking, cancellation, download failure and camera
ownership decisions synchronously through a small typed state machine. React subscribes to its
snapshot and connects the controller. Controls, shortcuts, pacing, retry and viewport restoration
keep their existing behavior; development and E2E builds expose the machine phase for readiness.

The dependency-free helper returns commands, keeps a bounded cause journal in development/E2E,
enumerates representative event paths for invariant tests and describes its table as Mermaid in
development. Quality guidance now requires machines or existing controllers for lifecycles with modes.

Replay-only geometry and readout code arrive with the existing replay download. The measured Live
download is 134,528 gzip bytes versus 134,634 before this pilot, within the unchanged 135,000-byte
budget. No new showcase is needed for this behavior-preserving refactor. No parity goldens change.

The four Windows teardown quarantines remain: Linux passing does not establish that their native
teardown races are resolved. XState is evaluated separately in a local throwaway comparison, with no
dependency added to the shipped implementation.
