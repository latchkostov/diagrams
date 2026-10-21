## Fix verification replays the run as it played

A thread-exhaustion callout offers the fix a same-seed rerun confirms. That rerun now starts from the run's actual
origin (the diagram, resolved simulation, seed, dot scale and traffic switch its engine was built with) and replays
every change the live controller made to the engine since, in order and at the simulation time it was made: Continue,
traffic, injections, faults, statuses, node tweaks, and Inputs, saved-simulation and diagram property changes that
patched the running engine without a rebuild. Live playback, scrubbing, rebuilds and verification apply these through
one dispatcher and one boundary rule (`src/sim/replayControls.ts`): the controls due by a moment apply first, in their
recorded order, and only then is a pausing note still waiting passed. A rebuild that rewrites history (an entry rate,
the dot scale, another script) starts a new origin; a seek back to a checkpoint keeps the controls up to it and the
traffic switch the live run restored there.

The controller keeps a revision that changes with every such control, seek and rebuild (pending or done), never with
time passing or the simulation's own timeline. The callout compares that number on each publication and builds the
immutable verification context only when it sends a request. Verification is single-flight: one request at most is
outstanding, a stale answer is dropped, and when one finishes the next request is for the revision current then, so a
burst of changes, or a script that keeps changing properties, sends nothing in between. Nothing is sent while a rebuild
catches up, for a refused run, or before anyone subscribes. The shared work budget and its deterministic "not
confirmed" (Events) fallback are unchanged.

Headless horizons that end between engine ticks round up to the tick, and planner samples stay once per simulated
second (and at pausing notes) whatever controls split the steps. No UI, examples or output goldens change.

A fix's toast repeats the words on the callout button that applied it, so the live view no longer loads the planning
text for it. An end-to-end test now waits for the verified fix before pressing it, and the badge contrast test reads
the red count where retried failures now leave it (the dead-lettering queue).
