## Scope and chrome budget

Reviewed against `docs/UX-PRINCIPLES.md`. This batch adds no application controls, dialogs, inspector fields or user-facing implementation details. The default editor chrome and progressive disclosure remain unchanged. Native select tests follow the operating system's popup lifecycle while retaining cancellation, committed value, focus and translated-label assertions.

## Readiness and focus

Live controls, a requested Live session, timeline markers, settled inspector selection and verified callout actions represent distinct boundaries. Tests now observe the boundary they consume. Held downloads, a paused page clock and a held real worker request exercise those gaps without removing the original behavior assertions. The generic Live navigation helper remains suitable for tests that intentionally hold the timeline download.

The inspector regression preserves the exact 16-pixel inset and reproduces the original mixed-state -355-pixel measurement. Affected geometry and focus cases plus annotation, drawing, viewport, platform and inspector neighbours passed 45 Linux executions at eight workers on four CPUs.

## Decisions still requiring evidence

macOS Control+click is a native secondary click; the retained modified-drag test conflicts with that convention. The orchestrator must choose the modifier contract before changing the gesture or its test. The peer-candidate diagnostic must establish the native transport boundary before any product connection-help change is proposed. No permission workaround, new network service, quarantine, tolerance increase or additional chrome is introduced here.
