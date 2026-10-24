## Load shedding review fixes

Editing a connection's priority now changes the diagram connection and preserves saved simulations,
including their existing overrides. Priority is not a supported saved-simulation override, so the
Inspector no longer writes it into one. Live metric updates reuse the saved-simulation comparison.

Imports validate priority against Critical, Normal and Sheddable. Playback safely treats unknown
values as Normal, including inherited object-property names. Hover summaries keep secondary problem
explanations ahead of cumulative shedding and queue facts.

Regressions cover saved-simulation preservation and reopening, hostile priorities, lower-priority
arrivals that must preserve critical waiters, equal-priority rejection, and applying and undoing both
caller and queue policies together in Free play and saved simulations. No parity goldens were changed;
the fix round uses targeted tests and leaves the full gate and parity verification to CI.
