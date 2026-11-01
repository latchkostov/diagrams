## Cause

Round-five Nightly 41276976443, macOS faults keyboard replay, reports the fault row unreachable after seeing the slow-motion row twice. The driver treats completion of the native ArrowDown input command as completion of React's active-row publication. It can observe the previous row again and reject a reachable item.

## Repair and regression

Wait for the actual active-row identity to change after each arrow, before detecting a cycle or sending another arrow. Keep real keyboard input, exact requested-row checks and the existing assertion deadline.

A Windows regression holds only the real menu's data-active publications while its genuine key handler runs. Navigation must remain pending until publication is released, then reach Fault. Temporarily removing the publication wait makes the regression fail because navigation returns early. The initial fixture incorrectly assumed which row was highlighted on opening; it now navigates to its stated starting row before holding updates.

No application, camera policy, timeout, tolerance, budget, skip or golden changes. Complete keyboard cohorts and native confirmation are recorded in the round-six verification fragment.
