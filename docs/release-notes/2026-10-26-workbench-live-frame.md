## Live frame

Live playback now occupies a 56px window footer under both the canvas and dock. Narration occupies its own canvas-column caption, and status uses a centred strip at the canvas top. The dock scrolls to row snap points above playback. Embeds keep playback within their own frame; presentation and recording retain the clock and timeline. Recording frames the whole presentation, including playback. The React Flow credit moves to a canvas corner.

A subject's caption offers its details in Properties. Focus lookup follows the canvas-view boundary across the new column. The worker glow follows the Live switch into the bezel; standalone Lab toggles remain available.

## Contracts and review

Existing playback, narration and trouble test IDs remain on their controls. live-controls moves to the footer; live-note and its child IDs move to the caption, with live-note-time and live-note-details added. Phone playback checks now verify the footer below the rail. Theme test setup chooses the explicit View submenu option before checking it. Assertions and timeouts retain their meaning.

The R6 request to make processed badges neutral needs no counter relabelling: NodeBadges derives its red badges from currentHealth(s).dropped, not processed. Actual loss stays red; changing those badges to processed would misrepresent the simulation. Camera, history and numbered Checks remain in their subsequent steps.

## Output parity

No goldens changed. Catalog signatures and rendered/exported layouts differ intentionally; the build spec reserves golden updates for step 12. This run reports those differences rather than re-recording them. The prior Workbench commits already changed catalog/render output. Full logs are in tests/.output/workbench-step6-parity.log.
