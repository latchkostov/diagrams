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

## Verification review follow-ups and the live session budget

Headless replays apply the controls due at a boundary before the planner samples it, so a control recorded at the
very end (2,000 messages injected at 50 s, say) is in the last sample and in a fix's verified end backlog. The
engine now reports the replica range a scaled node may use at the run's current Capacity × (`replicaBounds`, read
only, outside snapshots), and the planner judges saturation and converts replica counts to authored values with it,
so a Capacity change recorded during the run sizes the same as one saved in the simulation.

The live session is back within its download budget (130,753 B gzip against 135,000 B; it was 138,039 B). Applying a
thread fix ships in the trouble callout's own chunk and runs synchronously from its button. Slow motion's script
(pacing, captions, frames) downloads when slow motion first starts, or once Live is idle: until it arrives the
session shows that it is looking ahead with live paused where it was asked, Esc cancels, and a failed download goes
back to live with a Retry that takes the keyboard and gives it back. A toast's action pressed from the keyboard now
returns focus to where it came from when the toast goes, unless the action moved it.

## Trim review follow-ups

While slow motion's script downloads, live is held exactly as while the journey is recorded: a note's Continue, Enter,
step and seek wait, so the journey starts where the person asked for it and nothing in the timeline runs meanwhile.
Esc and a failed download release it. The bar says "Loading slow motion… · Esc to cancel" in its status slot. A failed
download's Retry belongs to the live view: it starts through the view's own start, is dismissed and disarmed when live
closes, takes the keyboard only from the live view that asked (never from a dialog opened since), and when pressed
while a dialog is open waits for the dialog to close. The planner counts a scaler's decisions only under the replica
range and Capacity × they were made for, and compares peaks as authored replicas.
