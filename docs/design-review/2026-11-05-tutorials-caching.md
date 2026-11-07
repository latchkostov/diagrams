## Caching tutorials UX review

Reviewed against the existing chrome budget and tutorial content contracts. The six lessons
reuse Properties, Inputs, the trouble callout, Fault menus and Simulations. No new global
control or confirmation is added. The first lesson explains a cache in ordinary words;
TTL, request coalescing and stale-while-revalidate follow the primary explanation.

## Findings resolved

The required read-only designer-agent review found a rule-repair dead end and imprecise
field anchoring. Assistance now repairs a matching Don't store or short-TTL rule without
replacing unrelated rules; appended ids remain unique. Composed cache editors declare field
and disclosure priorities, so the stale-window field wins over its enclosing section.
Regression tests cover both findings.

The stampede observation now uses the actual scale-one pill threshold. Traffic × 0.2 stays
in the longer-TTL check and repair, making its 40 requests/s feedback truthful. Hints expose
keyboard routes with key chips, including Home, F2 and Shift+F10. Cold-cache authoring
offers time, target, duration and Save anchors; matching distinguishes hard/soft and all-rule
purges. The replay checks use a new run rather than reusing the previous outcome.

The browser walkthrough exposed a soft-purge near miss being banked before the hard-purge
comparison. Its later step now reads the current saved Drill, so assistance cannot skip the
required change. The native TTL radio group has an explicit keyboard route. Preview changes
name a matched rule by its method and path, and the stale-window edit appears only once.

The shared keyboard driver now waits for the AI dock's actual focus handoff before
starting the next Tab route. A regression holds that focus request and verifies that
the driver stays pending; temporarily removing the wait makes the assertion fail.

## Evidence and limitations

The code review checked acts, observed results, caveats, Skip, escalating help, keyboard
solutions, reconstruction and no-save behavior. Seeded outcome tests use five seeds for
the introduction, demand/TTL estimate, p95, stampede, stale refresh and purge comparison.
The public cache-stampede example supplies the reference comparison; small exercises live
in the Lab. Arabic instructions retain public example names exactly as the canvas shows them.

All six introductory coaches and all six finish sheets were captured from Linux Chromium and
visually inspected. Cards, primary actions, chapter totals and next-lesson numbering remain
readable without overlapping controls. Captures are in the owner's requested
`tutorials-hub-2026-10/caching/` folder. The initial designer review was code-based; browser
walkthroughs and the screenshot inspection supply the separate visual evidence.
The final read-only designer pass found no remaining P1 issue. The authoring panel's
scroll boundaries clip peripheral field captions; its highlighted target, Save and Run remain visible.
