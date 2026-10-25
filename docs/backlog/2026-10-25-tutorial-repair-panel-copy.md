## Simulations panel copy older than a tutorial repair

A tutorial repair merges into the running draft or the saved run (docs/design-review/2026-10-25-tutorial-repair-api.md).
It doesn't touch edits still pending in the open Simulations panel, which match the app's Inputs Save. If the learner
then presses Run or Save in a panel opened before the repair, the panel's copy wins, and any run-only setting the repair
fixed in that run reverts. The diagram's repaired value is unaffected. This matters only when the run overrode that
setting itself.

Consider an app-level contract for external edits to an open working copy, used by the Inputs panel, the inspector and
tutorials alike, rather than a tutorial-only path.
