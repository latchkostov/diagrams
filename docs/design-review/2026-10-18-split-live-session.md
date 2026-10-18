## Live session extraction UX review (2026-10-18)

This refactor adds no controls or chrome. Live, trace, slow-motion, capacity, presentation and
recording retain their DOM, test ids, accessibility text, menu order and keyboard behavior.
All camera requests still go through the existing controller, with their original events.
An expanded-hook audit confirms the original 111 session calls and six edit-capacity calls
retain their order, effect kinds and dependency arrays.

The engine-cost fix changes only which frames train the catch-up estimate. Live waits still
draw their original frozen frame, while resumed playback retains its measured engine budget.
No new showcase is needed because no simulation, planning or stencil feature was added.

The history places upstream entry creation with capacity inputs: it creates the rate field
the panel edits. Consumer/dead-letter creation and persistence remain with live fixes. Panel
state and phone-panel arbitration stay with playback commands; trace and slow-motion phases
share one module while composition preserves the original hook order.
