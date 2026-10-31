## Scope and chrome budget

Reviewed against `docs/UX-PRINCIPLES.md`. This batch adds no application controls, dialogs, inspector fields or user-facing implementation details. The default editor chrome and progressive disclosure remain unchanged. Unsuccessful native-popup experiments are removed; the original cancellation, committed value, focus and translated-label assertions remain enabled.

## Readiness and focus

Live controls, a requested Live session, timeline markers, settled inspector selection and verified callout actions represent distinct boundaries. Tests now observe the boundary they consume. Held downloads, a paused page clock and a held real worker request exercise those gaps without removing the original behavior assertions. The generic Live navigation helper remains suitable for tests that intentionally hold the timeline download.

The inspector regression preserves the exact 16-pixel inset and reproduces the original mixed-state -355-pixel measurement. Affected geometry and focus cases plus annotation, drawing, viewport, platform and inspector neighbours passed 45 Linux executions at eight workers on four CPUs.

Accessibility scans observe completion of the actual view entrance before measuring contrast. The product animation, colour tokens and WCAG rules stay unchanged. A held-entrance regression proves scanning cannot begin early, while a settled violation still fails.

The bend-carry fixture similarly waits for the camera controller after Fit before measuring the next drag. A paused animation can have an unchanged transform while still pending; the fixture must not interpret that as settled geometry. The shared helper remains available to tests that intentionally interrupt a fit.

Entry-point Undo checks also distinguish document mutation from the renderer's restored topology. Holding real node measurements reproduces the missing-edge intermediate state; releasing them must produce the exact original topology, including all original edges.

The late-script cancellation fixture likewise controls simulation time while code arrives, then proves progress after an explicit clock advance. It preserves the product's real playback behavior and checks the cancelled action cannot take over the live controls.

## Decisions still requiring evidence

macOS Control+click is a native secondary click; the retained modified-drag test conflicts with that convention. The orchestrator must choose the modifier contract before changing the gesture or its test. The native-select boundary also needs an input-driver or coverage decision, documented separately. The same-run peer diagnostic confirms mDNS fails while direct candidates deliver on macOS; branch Nightly 41183332686 has none of the 31 persistent peer-admission failures. No new network service, quarantine, tolerance increase or additional chrome is introduced here.
