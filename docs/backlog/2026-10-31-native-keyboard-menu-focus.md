## Visible context-menu rows precede keyboard ownership

Baseline Nightly 41253920016 fails macOS faults replay with sim.fault unreachable while sim.inject remains active. The trace begins navigating rows immediately after the menu becomes visible. ContextMenu deliberately takes focus in its placed-menu effect; visibility is an earlier signal, so a key can still reach the canvas.

The keyboard lesson driver now waits for the target row's own menu level to contain activeElement before sending its first navigation key. It still navigates entirely with real keys and retains the original row-cycle detection and lesson assertions. Command-palette navigation keeps its existing focused-input acknowledgement. The owner is the menu level, including a searchable menu's field outside its inner list.

A native Windows regression holds the real placed menu's focus call, invokes the actual driver and then releases that call. Restored: it reaches the exact sim.fault row. Temporarily restoring the old driver fails with Keyboard row is unreachable: context-menu-item-sim.fault. A proposed additional wait for active-row publication was removed: this repair is limited to the reproduced ownership gap.

The first Linux candidate exposed an incorrect role-based owner on request-vs-message and dots-and-sides: searchable menu fields are outside the inner role=menu list. That candidate run was stopped and is not counted as passing. The corrected owner has a separate real searchable-menu regression. One extra Windows run overlapped a gate rebuild, replacing its preview assets; its 404 failures are invalid evidence. The stable-assets Windows cohort passes all 14 executions on two CPUs/three workers. The unchanged Lab sweeps also pass all three constrained Windows cases, so no Lab partition or budget change is made.

No application focus policy, timeout, tolerance, budget, skip, quarantine, retry or golden changes. Remaining replay failures require their own native evidence.
