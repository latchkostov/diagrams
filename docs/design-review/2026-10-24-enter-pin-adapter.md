## Enter ownership regression review (#293)

Keep the established Enter-to-pin behavior and the current readout ownership and traversal improvements. The keyboard adapter requires state and actions; visibility and eligibility are optional capabilities supplied by the full readout layer. An explicit false still leaves Enter to the focused control or rejects the item as a pin target.

No controls, text, layout, or Tab order change. Reject removing the visibility and eligibility guards: the no-room and inert-target browser regressions depend on them. Preserve every existing keyboard assertion.
