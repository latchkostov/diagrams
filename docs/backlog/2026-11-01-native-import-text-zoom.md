## Loaded reproduction and cause

The combined Linux cohort reproduces the annotation round-trip failure after the initial Overview preparation. Its trace ends in Overview, idle, at zoom 0.5456 with data-detail-text-hidden on the title. The current textDetail policy intentionally hides secondary text below 60%; an initial camera decision replacing Overview is not established as the cause. Three simultaneous Windows executions on two CPU cores reproduce the same failure once.

## Exact visibility at a readable zoom

Wait for the imported camera, fit the whole drawing and wait for that camera transaction too. Establish that the fitted title is hidden, then use the existing Zoom to 100% shortcut and wait for completion before the unchanged all-annotations visibility, text and connection checks. This makes the import test exercise the semantic hide floor instead of sometimes passing before detail has updated.

No product, camera/detail policy, below-60% edge-navigation rule, timeout, tolerance or budget changes. Temporarily removing Zoom to 100% must fail the final title visibility assertion after the hidden precondition has been acknowledged. Final targeted and native results are recorded in the round-six verification fragment. The compose-override preparation remains Overview: its node visibility and annotation text have different requirements at far zoom.
