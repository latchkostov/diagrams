## Native Nightly keyboard input

Keyboard tutorial recipes now send character keys when typing a name, including while a newly
created node is waiting to be measured. Chromium's direct text insertion emits no input event on
the focused canvas, so the previous driver could silently lose the name before Label took focus.
The application already buffers real character keys; its behavior is unchanged.

A controlled browser regression holds the new node's measurement, types through the real recipe
driver, commits with Enter, then checks Undo and Redo. Direct insertion fails the saved-name check;
character keys pass. No deadline, tolerance, assertion, budget or skip changes.

Full output parity passes: all 3,178 goldens are unchanged; no golden is re-recorded.
