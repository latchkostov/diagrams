## Windows Checks sweep timeouts

During #447 fix round 1, the production-build sweep selected by Checks, Inspector findings and
notification test IDs initially timed out in four `ai-agents.spec.ts` canvas-loading setups and four
`i18n.spec.ts` canvas-chrome cases. One i18n failure occurred during context teardown; the others
reached the existing whole-test backstop. The Kafka assignment-vocabulary case in
`planning-p2.spec.ts` later reached the same whole-test backstop. Assertions and timeouts were not
changed.

The affected startup spec passed twice on this branch (20 cases). The i18n canvas-chrome group also
passed twice (18 cases). Both focused checks passed twice on an untouched export of
`origin/master` at `3e4b9305018249be40eefafc47ce2d043ccbdd03` (20 and 18 cases respectively).
The affected planning case passed twice on both trees (two cases each). These are unreproduced
sweep failures, not confirmed failures on master.

## Follow-up

Keep the original traces and aggregate failure counts in the fix-round report. If these recur,
inspect the concurrent startup/network and browser teardown stalls before changing app behavior or
test assertions. The startup traces show the shell mounted while canvas and example module requests
were still pending; they do not establish a Checks computation failure.
