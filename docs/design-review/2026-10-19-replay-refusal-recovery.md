## Replay refusal recovery UX review

The existing notice and Inputs/Restart actions provide recovery without adding chrome. An abandoned replay cannot silently collect future edits. Disabled timeline controls now match the controller's blocked seek behavior, including keyboard navigation. Successful correction retains the selected simulation and restores playback; invalid Restart preserves the notice.

A refused unsaved simulation remains visible in the picker instead of becoming a hidden draft. Waiting-plan reuse preserves the same hover readout and deferred loading while removing repeated whole-diagram calculations.

The loading-time node reading region and Inputs loading/error focus handoff need their own focused accessibility change and held-download browser coverage. They are recorded in the matching backlog fragment rather than expanding this replay fix into a focus/placement refactor.
