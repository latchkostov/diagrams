## Keep focus after the Inspector naming handoff

A name field's deferred frame retry now stops when another control outside the canvas takes focus.
The Inspector resizer and assistive focus navigation keep the next key instead of having focus taken
back by the previous Label request. The existing retry still repairs focus returned to the canvas by
a closing menu, and typing or clicking retains its existing cancellation behavior.

The controller regression focuses another control between the field handoff and its retry. It fails
when the repair is temporarily reverted and passes with the repair, alongside the existing menu and
pending-name tests. The real browser regression holds that handoff on its fake frame clock: in Linux
under parallel load it fails 30/30 before the repair and passes 30/30 afterward. Full output parity
passes all 3,178 goldens unchanged; none is recorded or updated.
