## Interaction recovery and robustness follow-ups

Peer document updates preserve queued keyboard navigation and Inspector field requests. A newer
conditional peer recovery replaces an older recovery, following the latest focused element. Undo of an
edited or deleted dependency while Dependencies are hidden finishes on the canvas instead of polling
for an edge that will not mount. Edges expected to mount still wait for rendering.

Live session feedback, action labels, Undo actions and slow-motion notes now use the translation
catalog, removing all six literal-text exemptions. English wording stays the same. The wait for a
dead-lettered message keeps its identity across language switches. No controls or shortcuts are added.

The slow-motion browser test keeps all forty clock steps, freeze assertions, dot bounds and caption
checks, with one browser read per sample. Collaboration, repeated draw.io IDs and AsyncAPI growth
checks count work instead of CPU-quota-sensitive wall time; the eighth-sized inputs and limit of 24
remain. Deliberately quadratic variants fail the counted-work guards.

Self-host smoke navigation waits for three consecutive successful endpoint responses, resetting on
HTTP failures or network errors. Navigation itself is never retried. Nightly property-only failures
now trigger the shared failure issue; uploaded JSON and multiline error details retain the failing
test, seed, shrink path and counterexample. Property failures appear first in the issue body.

Regression coverage includes focus interleavings, original-element removal, actual generated events
before and after Escape, later navigation superseding Escape restoration, hidden-edge Undo in the
production browser, interrupted network readiness, translated slow-motion notes and property-only
Nightly reporting. Temporarily reverting the fixes makes their focused regressions fail.

## Output parity

The only intended golden change is `node/i18n/catalogs.json`: nineteen English `liveSession.*` keys
increase the catalog count from 2,183 to 2,202, add the Live session area fingerprint, and increase
English fallback counts in the 37 translated catalogs by nineteen. The pseudo-locale derives the new
messages automatically. Existing message text and area fingerprints stay the same. Every diagram,
simulation, export, layout and browser golden stays unchanged; none is re-recorded to hide a failure.

## Verification

The requested slow-motion load run (`--linux --cpus 4 --memory 12g --workers 8 --repeat 3`) passes
all 279 cases across Live, slow motion, presenting, trace and relationships, with zero failed or flaky.
Each of the forty slow-motion samples now takes one DOM read instead of four (160 reads become 40);
all clock steps and assertions remain. The earlier clean-master deadline reproduction stays in the
resolved backlog fragment as evidence.

A fresh full parity run matches all 2,196 goldens after the single explained catalog update. Native
unit checks, production build and the 123.5 kB gzip entry budget pass. Controller properties
also pass with Nightly's 20× run multiplier and random seeds. Deliberate reversions fail the focus,
harness, Escape replay, translation, readiness and Nightly regressions; deliberate quadratic variants
fail each new work-count guard.

The wider quota run exposed the same clock-ratio problem in the pre-existing separated pinned-route
nudge test (29.66 against 24). That guard now counts segment geometry and candidate comparisons,
retaining 3,750/30,000 routes, the limit of 24 and exact unchanged-route assertions. Routing code
and output are unchanged. A deliberately restored all-pairs comparison fails the counted-work guard.

Five wider Linux repetitions at four CPUs, 12 GiB and eight workers pass all 750 browser cases,
covering relationships, bulk selection, annotations, drawing, viewport, platform and the Inspector
specs. The initial unit phase exposed only the old pinned-route clock guard described above; its
counted replacement passes the focused regressions. Root and subpath Docker image smoke tests pass.
An actual failing fast-check JSON report also preserves the failing test, seed, shrink path and
counterexample through the shared issue formatter.

The first full gate caught a collaboration focus regression: a pending Inspector retry lost its
owner to a peer deletion, and merely preserving that request left focus on the page. Conditional
recovery now waits beside the user move and focuses the canvas only if focus is still lost after
the old control disappears. It preserves a parked request for a surviving field, yields to newer
navigation and cancels on unmount. Four deterministic scheduler regressions cover these cases.
The unchanged remote-deletion and remote-stencil-change browser assertions both pass with the fix.
The failed full run was stopped after the concrete regression was captured (799 passed, one failed;
789 cases were skipped or interrupted). Eighteen deliberate variants reject the missing fixes without
type errors.

After the owner-removal correction, the final Linux sweep includes the collaboration spec and all
focus/viewport neighbours: five repetitions, eight workers/eight CPUs/20 GiB, 855 passed, zero
failed or flaky. Application code stayed unchanged throughout those repetitions.
