## Fault drills UX review

The existing live node menu keeps its row count: one **Fault** parent replaces the separate Kill row, and Slow down
and Fail move out of Behaviour. Fault has at most four rows (Take down/Restore, Slow down, Fail, Clear slowdown and
failures), with three factors and two percentages beneath them. Slowdown is offered where service time is meaningful;
sources do not offer injected processing failures. Boundary and eligible edge menus add one parent with one action.
The existing action registry, interaction controller and menu keyboard behavior remain in charge; this batch adds no
camera movement, focus effect, timer or bar control.

Four named presets sit inside the timeline's existing **Add step** select, together with Note. Each becomes a small
editable Fault step with kind, target and magnitude. An unavailable target produces an in-place warning, rather than
a new wizard. Every new interactive element has a test id and accessible name. New strings use the translation catalog.
The saved scenario is called a Drill; its action is Fault. The report and dependency outages stay outside this batch.

Restoration is discoverable in the same menu location. A member’s Restore action is disabled with a boundary-first
hint while an enclosing outage holds it down (including the existing Revive callout); it never silently changes the underlying status. Boundary outages preserve underlying per-node statuses and
compose with an outer outage. Fault overlays do not overwrite configured latency/failure settings. Cut links apply
only to flows between declared boundaries; dependency edges keep their existing meaning. Checkpoints include the
overlay and RNG, and membership changes are topology changes that restart playback. Clearing an injected fault reveals
current settings. Repeated slowdown choices replace rather than compound one another.

Visual review moved this example's narration to the existing caption position above the live bar, clear of the
outage callout, and made the load balancer subtitle accurate for both runs. The public Zone outage drill is intentionally small: two service/store pairs behind one health-check load balancer.
The first run loses nothing; the comparison visibly drops checkouts within the first few seconds. During a boundary
fault, down members keep a small dropped-count badge (using the existing alert position and a translated tooltip);
otherwise down status had hidden that number. The healthy run shows none. This is the node’s counter, not a drill report. A down boundary has
a grey fill, dashed border and × marker, so color is not the only cue. The first browser regression caught a boundary
selector that changed members but left the box colored; the corrected selector addresses the actual boundary element.
The browser tests also cover restoring/clearing decorations, checked magnitude choices, link recovery, preset saving
and the two public simulations. Existing Live and slow-motion tests walk the new submenu while retaining their assertions.

Rejected: additional toolbar buttons, separate top-level fault rows, overwriting saved node props for a temporary
fault, automatic dependency outages, and a premature drill report. These would expand chrome, lose restoration state
or cross the agreed PR boundary. Entry size keeps its existing budget; the skill zip's explicit 5 kB increase covers
the new playback/contract rather than weakening any timing or camera assertion.

Boundary ancestry is indexed once at engine load. An operation-count regression proves 500 parent reads for 500
nodes/boundaries (the initial implementation made 250,000); it uses no wall-clock budget.

The Linux load run exposed an existing real-time assumption in the paused Revive/focus test: while operating menus
at 4×, broker lag could become the next valid callout after the down node was restored. The test now starts paused,
so it isolates status restoration and focus with every assertion preserved. No product behavior or timeout changes.
