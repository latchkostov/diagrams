## Native drag activation origin

The drawing driver assumed its three-pixel activation move always started the drag. Native/dev delivery can already have activated it at mouse-down, so adding that move again shifted the final node by 3 / zoom. Linux Dev reproduced the exact 3.305 flow-pixel error with the original 1.5 tolerance.

The driver now observes the existing guide layer's real activation boundary and records that input event's client coordinates. It calculates the same requested flow-space offset from that origin. The 404/153 off-grid assertions, 803/-297 input offset, two-gap assertion and exact 800/0 snapped position are unchanged. No application behavior, budget, tolerance or golden changes.

The tracked-source Linux Dev run (three workers/three CPUs) failed 1/10 before the fix, passed 10/10 with it, and failed 1/20 after temporarily restoring the old driver; the reversion also reproduced missing equal-spacing guides. All 14 Windows drawing-precision cases pass. Linux production repeats cover the whole spec rather than only the two failures. The dev archive uses the same tracked source as CI.
