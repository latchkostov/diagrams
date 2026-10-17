## Camera merge review

The merge preserves the established gestures and adds no controls. Shift+2 brings the selection into
the measured pane at up to 125% zoom and wins over a pending Inspector reveal. It takes manual camera
ownership, so a subsequent pane change preserves that zoom. Whole-diagram fits and narration still take
ownership from earlier manual input, and later manual input invalidates their deferred work.
Inspector opening and other pane changes share one deferred handler, so a second pan cannot retain
the first pan's intermediate zoom. Open menus defer that adjustment until they close.

The platform regression and the branch's Inspector ownership cases cover these complementary rules.
Ownership unit tests also cover returning to the same owner without reviving an old command.

Taking either side of the camera conflict wholesale was rejected: the old direct selection fit loses
master's deferred reveal protection, while treating every measured fit as whole-diagram ownership loses
the branch's manual pane behavior. The merge retains both cancellation mechanisms.

## Full-suite interaction review

Dragging a node takes manual ownership, preserving the drop's scale when its selection opens the
Inspector. An explicit Fit or subsequent Live/narration transition still replaces that ownership.
The full-suite follow-ups prepare the real pane before coordinate gestures and text measurements;
they retain the pointer hit-tests, resize cap, displacement checks and Undo assertions. No viewport
enlargement, forced click, hidden Inspector or production timeout change is used.

Export success is checked when the download begins. File copying can finish after the notification
goes away; a fake clock exercises that order without extending the toast's duration.
