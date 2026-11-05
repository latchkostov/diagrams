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

## Evidence and limitations

The code review checked acts, observed results, caveats, Skip, escalating help, keyboard
solutions, reconstruction and no-save behavior. Seeded outcome tests use five seeds for
the introduction, demand/TTL estimate, p95, stampede, stale refresh and purge comparison.
The public cache-stampede example supplies the reference comparison; small exercises live
in the Lab. Arabic instructions retain public example names exactly as the canvas shows them.

This fragment will be updated with browser and screenshot results after Linux admission.
The designer review itself was code-based and does not claim a visual walkthrough.
