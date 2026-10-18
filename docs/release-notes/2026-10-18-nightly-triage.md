## Nightly camera and AI composer fixes

Settled panel work now goes through slow motion's camera while slow motion is
active, including the event ordering found by Nightly's random property test.
It runs once and cannot fall through to normal centring.

Saving the first edit of a public example keeps the AI composer's next request,
reply, focus and dictation session. The panel follows the mounted editor; its
conversation still follows the saved document. A genuinely different editor gets
a fresh composer.

## Test readiness and remaining coverage

Development builds now record the interaction journal, like the camera journal.
The collaboration fixture preserves Vite's own WebSocket. Playback tests control
their simulation clocks, iframe keys target the iframe's node, export cancellation
holds a real PNG decode, and camera tests wait for the controller's readiness.
The autoscaling announcement test observes every readiness publication in the
page instead of taking up to eighty browser round trips.

Under the requested two-round triage rule, seven unresolved native Windows cases
are marked `test.fixme` on Windows only, and the checks typing CPU comparison is
marked `test.fixme` on all platforms. Their assertions, timeouts and retry counts
are unchanged. Evidence and removal criteria are in the
[native loading/teardown follow-up](../backlog/2026-10-18-nightly-native-load.md)
and [checks typing follow-up](../backlog/2026-10-18-nightly-checks-typing.md).
The [failure inventory](../design-review/2026-10-18-nightly-triage.md) lists every
failure from run 39115946465.

## Output parity

All 2,196 output parity goldens match unchanged. No simulation, export, layout or
translation output was re-recorded to accommodate these fixes.
