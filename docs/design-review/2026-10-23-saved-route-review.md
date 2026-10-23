## Saved-route readiness and recovery

The review fixes add no controls or chrome. Saved detours remain visible when opening a diagram, changing Live panels and exporting an image. The canvas stays usable while optional geometry downloads; existing viewport ownership still cancels automatic fitting after user input.

## Recovery and contracts

The existing Retry action recovers every required failed edge module, including failures on separate connections. Dependency-detail readiness updates only visual consumers. Clipboard validation refuses malformed geometry before insertion, while valid boundary coordinates survive schema validation and native loading. Automatic diagrams retain their established fitting behavior.

## Regression coverage

Operation-count tests cover many fixed routes in both fixed-only and mixed drawings. Unit regressions cover clipboard limits, schema/native boundaries, bend-swap protection, retained routing caches, Live fits, pane readiness, export measurement and shared retries. Browser regressions hold the geometry chunk through initial fitting and image export, and fail both optional edge chunks on separate connections.
