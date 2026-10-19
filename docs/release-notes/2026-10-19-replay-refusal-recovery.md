## Replay refusal recovery (PR #189)

A lifecycle allocation refusal inside a replay now stops the requested run with the existing recovery notice and clears the abandoned replay and its queued actions. Restart or a corrective Inputs edit rebuilds it successfully; Play and Step then advance again. A queued Continue refused after replay finishes retains its existing retry behavior.

Timeline scrubbing and jump markers are disabled whenever the run requires a rebuild. Unsaved simulations that were selected but could not start remain available as drafts; invalid selections still leave the prior selection intact. Hovering different nodes reuses the waiting plan for the same diagram and configuration, with computation deferred until the first detail view.

Regression coverage uses recorded replica increases and decreases followed by an Inputs change that refuses during a later replay slice. Browser coverage keeps the refused simulation selected, verifies Restart still refuses invalid sampling, and checks valid sampling restores playback and the expected message count.

No output golden changes are intended; no goldens have been re-recorded.
