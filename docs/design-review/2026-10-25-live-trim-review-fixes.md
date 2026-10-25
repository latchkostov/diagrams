## PR #341 fix round: ownership through replay loading

The existing trace card remains one instance, preserving keyboard focus without an
imperative focus transfer or a mount-triggered focus request. Its Slow motion button
becomes Pause in place. The interaction controller reserves pending replay keys at intent
time, and delegates them to the loaded handler through the same capture stack. Panels,
dialogs, naming, native controls and recording retain their established precedence.

An armed replay has no script to record. Returning to the existing setup dialog with
an explanation avoids an empty countdown and gives the person a concrete next action.
No controls or chrome were added. The release changes restore existing replay behaviour;
they do not introduce a simulation, planning or stencil feature requiring a new example.

Rejected: transferring focus on runtime mount, because a download completion must not
steal focus; starting a recording from the facade's settled state alone, because an armed
replay is settled but has no take; and a separate late keyboard listener, because canvas
naming and nudging may already have consumed its key.

## Regression checks

The four P1 regressions run with held and already-loaded runtime code. Temporarily
restoring the separate trace-card subtrees, allowing scriptless recording, removing
panel precedence, and releasing canvas keys each fails its corresponding held case.
Both panel owners are covered. Synchronous handoff and an unstable replay command also
fail the new Strict Mode and callback-identity unit regressions. Removing generation
cancellation fails the strengthened late-completion simulation-switch regression.

Two existing test gestures were corrected without changing their assertions: hover the
short edge's exposed label rather than its overlapping connection handles, and install
the palette hold before navigation can preload its chunk.
