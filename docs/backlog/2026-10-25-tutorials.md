## P2: reserve translated tutorial strip space

The production shipping review at 1280 × 800 found that mobile-api's add-api strip grows
from 76 px to 82.71875 px in en-XA, then returns to 76 px at name-api. English and Arabic
stay at 76 px through those transitions. Reserve space without clipping long goals, hints
or near-miss feedback, and keep a geometry assertion across transitions. Do not alter
runner completion, focus or camera assertions to hide the change.

## P2: fluent tutorial language review

All 992 tutorials.* messages are translated and source-stamped in all 37 languages, including
the checkout study. ICU, placeholders, plurals and glossary validation pass.
They remain machine translated: fluent reviewers should check the technical prose, named
nodes from example diagrams and instructions naming controls whose other translation batches
still fall back to English. Keep the Language dialog's machine-translation notice until a
whole-language fluent review is complete.

## Bundle follow-up

The existing Live session warning remains below the 8,192 B advisory headroom floor. The
shipping measurements are recorded in the release note and PR; budgets remain unchanged.
A dedicated Live trim should recover advisory headroom without changing simulation output.
