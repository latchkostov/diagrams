## Recovery partial allocation (PR #206)

Reviewed against the UX principles. Restoring a node after reducing its capacity now
allows its interrupted request to finish, matching fresh admission under the same cap.
Limits added during an outage also apply on restoration. Remaining work, retry deadlines
and spent quota credit keep their existing meaning.

This correction adds no controls, text, chrome, persisted diagram fields or user steps.
Trace selection keeps its existing behavior and avoids traversing unrelated queued work.
Existing public examples continue to demonstrate the simulation; this fixes recovery
rather than adding a new simulation, planning or stencil feature.
