## Platform viewer UX review

The platform viewer adds no global controls: it reuses the existing Live toggle, playback bar,
simulation picker and read-only canvas. Initial loading shows a status; rejected loads report a
host error while preserving the last valid diagram. Loading a saved simulation never starts it.
There are no editing or sharing affordances and no outbound branding link.

Auto-height uses the web component's measured content geometry, avoiding a second viewport-height
feedback loop. The host decides how to apply the height through its platform bridge. Dedicated
font files preserve the existing typography under restricted hosting policies.

The Confluence wrapper retains reserved space while deferred. It is a labelled keyboard stop;
focus initializes its frame and attachment request even when intersection observation has not
fired. Its existing Play button works for both saved simulations and free play. These behaviors
are covered under the real host policies with test-id selectors.

No destination picker, new toolbar, platform manifest or platform permission flow is introduced
in this phase. Public simulation showcases already demonstrate playback; this phase adds a
hosting artifact, not a simulation, planning or stencil feature.

The E2E build prepares the static artifact before browser workers start. Building it inside each
browser worker added CPU and filesystem contention during preview startup in the initial load run;
the tests now serve the prebuilt artifact under an independently specified Forge-like policy.
