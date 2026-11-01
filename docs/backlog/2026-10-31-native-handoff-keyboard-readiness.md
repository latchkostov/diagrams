## Finished strip precedes handoff keyboard readiness

Round-five diagnostic Nightly 41263869369 (21fc594a4) fails macOS tutorials-syllabus: handoff starts the next lesson directly and Escape leaves the canvas usable. The trace sees the finished strip, sends Escape immediately and then finds the handoff still present. FinishHandoff intentionally focuses its heading and attaches its Escape listener on the following animation frame, after any completing modal's cleanup and key event.

The dismiss driver now awaits that exact heading's focus before sending Escape. The original dismissal, canvas-focus, finished-state, context-menu and chapter-navigation assertions remain.

A regression holds the actual animation callbacks requested after the handoff heading mounts, leaving unrelated earlier completion frames free. It invokes the dismiss driver and releases the held callbacks. Native Windows passes the regression and original next-lesson flow. Temporarily removing only the heading-focus acknowledgement reproduces the exact original failure: tutorial-handoff has count 1, expected 0. No application focus policy, listener timing, delay, timeout, tolerance, budget, skip, quarantine, retry or golden changes.
