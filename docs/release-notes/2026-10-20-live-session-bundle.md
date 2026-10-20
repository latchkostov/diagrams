## Live session download budget

Capacity callouts and their placement code now download when capacity is shown, separately from the
always-visible node badges. Narration and run-result callouts download when a note or completed run
needs them. Existing loading failure/retry handling applies; simulation execution and callout content,
actions, placement and focus rules are unchanged. No controls or settings were added.

Measured after syncing with origin/master, with Node 24.22.0 and `node scripts/bench/bundle.mjs`
(the CI bundle gate: production build, no E2E hooks, gzip level 9, summed static dependency closures):

| Download        | Before (B gzip) | After (B gzip) |
| --------------- | --------------: | -------------: |
| liveSession     |         135,859 |        132,413 |
| startup         |         176,922 |        176,938 |
| canvasFirstView |         382,887 |        382,885 |

Live is 2,587 B below its unchanged 135,000 B budget, saving 3,446 B. Startup and canvas remain
under their existing budgets; their small byte changes come from bundler chunk references.
No parity goldens change. No simulation output, schema, example or translation is changed.

The verification oracles already enter the engine only through caller-supplied diagnostic callbacks;
they are absent from the shipped build. A production-bundle regression now guards that exclusion and
the optional callout boundaries in both default and collaboration builds. Tests hold each callout's
download while checking that Live remains usable and its pending action survives.

Budget increases and changes to engine/checkpoint APIs were unnecessary. Simulator cleanup was left
out of this focused download fix to avoid changing execution behavior or reducing oracle coverage.
