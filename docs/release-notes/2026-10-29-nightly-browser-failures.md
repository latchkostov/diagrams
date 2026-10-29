## Nightly browser fixes

Rail captions have four more pixels for text inside the same buttons. Greek's
Tutorials caption now fits with DejaVu Sans, an Ubuntu system fallback: Mona Sans
does not contain Greek. The label stays at 12 px, with wrapping and hyphenation.
No font substitution, shortened translation, clipping or assertion change is used.
Linux browser jobs report their Greek fallback selections after font provisioning,
so their environment can be compared directly with the pinned container.

Reopening AI before the previous close's animation frame keeps focus in the panel.
The stale close callback no longer moves focus back to the rail.

Boundary titles stay in their drag band while fonts load in development. The
decoration effect restores the canvas's detail attribute synchronously after
StrictMode cleanup, rather than moving the label after its font wait. Image
capture still clears frame-only presentation as before.

The tutorial Skip-all test driver waits for forward progress through a reference
replay. Returning temporarily to an earlier milestone no longer stops its fake
clock. The application tutorial runner is unchanged.

The pending/failed locale matcher fix is already in #390. Nightly 40813604106
actually tested `1f53b4779`, whose parent is `9798327fa`, before #390; this patch
does not duplicate that fix. Remaining single failures and verification evidence
are recorded in [the investigation](../backlog/2026-10-29-nightly-browser-singles.md).
Full output parity passes: 3,178 goldens, zero changed, added, missing or stale.
No goldens were re-recorded.

The inspector undo test completes naming and waits for the planning row to settle
before opening Simulation. A controlled blur/layout regression catches the old
missed click; the original edit and undo assertions are preserved.
