## Follow-ups 14: initial-download UX review

No control or chrome is added. The five default outlines remain eager. Non-default
outlines use a neutral rectangle in the same persisted box during their first download;
labels, selection and dimensions stay in place. Loaded outlines refresh visible handles,
React Flow’s measured handles and cached edge routes together. Handle measurements
use known node elements and one store update per canvas frame rather than querying
the DOM for every shape. Failed downloads offer the existing Retry toast.

The boundary inspector follows the existing annotation/multi-selection inspector’s
lazy-loading convention. The colour picker remains behind its existing custom-colour
button. Provider and format marks reserve their icon dimensions while loading. File
imports use the same parsers, validation, warnings and page-picking rules.

Rejected raising budgets, changing geometry or routing algorithms, and re-recording
shape goldens: this is a download-boundary change and must preserve final output.
Metadata used by menus and search remains eager so discovery needs no new async state.
Build tests cover both default and collaboration builds; a held-download browser
regression checks no extended geometry request for default shapes and unchanged
outline dimensions when a triangle replaces its placeholder. Cache and batching
regressions cover late geometry and large groups of outline measurements.

The first Linux load run exposed a real intermediate-state race on its third repetition:
a non-default outline could arrive before its attachment sampler. Geometry publication
now awaits the sampler; a deterministic held-module test fails when that await is removed.
The visible-stroke assertion stays unchanged. Removing the route revision likewise fails
the cache regression; restoring eager catalog loading fails the real bundle checks in both
builds. All deliberate reversions were restored before final verification.
