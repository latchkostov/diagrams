## Tutorial name translation quarantine · PR #356

Tutorial instructions that misname a sandbox simulation or node now use English fallback,
restoring the matching names learners see in the picker and on the canvas. The all-language
guard covers every lesson's step titles, goals, hints, completion instructions and coach marks,
including bare names. It checks sandbox names by stable ID through the real compiled catalogs.
Restoring the original German catalog makes the guard fail on the reported names again.

Quarantined 5,444 locale/key pairs across 197 keys in all 37 translated languages. This includes
dependent lesson-created labels and shared lookup aliases needed to keep fallback instructions
consistent. The complete pair list and restoration plan are in
[the tutorial backlog](../backlog/2026-10-25-tutorials.md). Retained translations still require
current source stamps. English source strings, lesson behavior and completion checks are unchanged.

Only `tests/parity/goldens/node/i18n/catalogs.json` changes: all 37 tutorial fingerprints and
fallback counts reflect the removed translations. The `stencil` fingerprints change in 27 locales
where the shared `Client` lookup also falls back; `autoscaling` fingerprints change in 35 locales
because removing the duplicate tutorial `HPA service` title changes shared catalog lookup selection.
No autoscaling source translation was edited. English and pseudo-locale fingerprints stay unchanged.
The other two i18n goldens are unchanged; no diagram-output golden was updated.

The proper stable-ID interpolation fix and R-48593b382a's lazy language-catalog split remain
backlogged because the review round cap has been reached. The latter records the review's
65,944 B German and 82,005 B Japanese lesson-value measurements before compression.
