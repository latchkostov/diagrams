## Workbench frame tokens (step 1)

Added the light/dark frame vocabulary and AA checks for bezel, rail and Live ink.
No controls or test ids move in this step; the entry JavaScript is unchanged.

## Sequencing decision

The spec calls this an additive, visually unchanged step, but also requests changing
the existing accent and stage background. Applying its accent values changes eight
SVG export structure goldens (selected marker declarations). Keep the existing
accent and stage background until the visual phase, where output changes can be
reviewed together. No goldens were re-recorded.

The transport stays inside the canvas until step 6, so retain its overlay protection
and live-bar fit inset throughout part 1.

## Validation

The quick gate passed six token tests and four chrome browser tests with no failures
or flaky tests. Making bezel ink identical to its background fails the new contrast
test; restoring it passes. The first parity run passed all Node cases and 102 browser
cases, with eight accent-only SVG mismatches, prompting the additive change.
