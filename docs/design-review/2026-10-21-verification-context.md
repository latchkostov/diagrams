## Fix verification follows the run as played (PR #225)

No surface changes: the trouble callout stays the only action surface, with the same wording, hierarchy and chrome.
What it offers now always describes the run on screen. A Continue, an Inputs change, a diagram property edit or a
node tweak withdraws a verified fix at once (the callout shows Events) until the replay of that exact run confirms
one again; a script that changes properties on its own no longer makes the advice flicker or queue work. While a
rebuild catches up, advice waits rather than describing the half-rebuilt run.

The fix toast is unchanged: it names the fix and, during a saved simulation, the simulation it went into, and its
Undo returns focus to the canvas after the history commit when the toast held it.

Reviewed through source, unit regressions comparing complete live and headless node and edge state (Continue around
same-time timeline changes, timed Inputs, Capacity, traffic, diagram edits, superseded tweaks, seeking back), and
production-browser tests at the worker boundary (Continue and a timed Capacity change; a held request during an
Inputs burst). Not a rendered whole-app walkthrough.

## Downloads on first use (bundle trim)

Slow motion chosen before its script has arrived looks the same as its existing look-ahead: Play is disabled, live
waits paused, the menu's node keeps the keyboard, and the replay starts when the code arrives. Esc cancels as before.
A failed download says so in the usual toast; its Retry takes the keyboard (the person just asked for slow motion)
and gives it back. A trouble callout that is still downloading simply hasn't appeared yet; when its download fails,
the toast's Retry does not take the keyboard, since nobody asked for the callout, but pressing it hands focus back to
where it was. Covered by hold-the-chunk tests (tests/e2e/lazy-live-fixes.spec.ts): focus, pointer and bar styles,
and export while held, after arrival, and after a failure.
