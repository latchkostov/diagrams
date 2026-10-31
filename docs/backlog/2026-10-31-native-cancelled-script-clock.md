## Control playback while a cancelled script arrives

Windows shard 7 in Nightly 41183332686 reaches the final assertion of the held slow-motion script cancellation case with live playback already `done`, instead of `playing`. The test intentionally resumes the authored 8× simulation, then waits for real script download and evaluation. On a slower native runner, that uncontrolled interval can legitimately finish the run; it does not demonstrate that the cancelled script restarted slow motion.

The fixture installs the page clock before navigation, waits for the note and camera to settle, then pauses it. The existing control freeze, Escape, Continue, focus, loading and slow-motion assertions remain. After the late module evaluates, both the page's frame clock and the simulation must still be at their exact captured times. An explicit 250 ms of fake-clock playback then must advance simulation time and retain `playing`, with slow motion off and the controls enabled. No real-time delay, deadline, tolerance or budget is increased.

The existing case, strengthened by exact frozen-time and subsequent-progress assertions, is the regression. Removing the fixture's clock pause must fail the frozen-time assertion; the native comparison and final Linux/native results are recorded in PR #403. A busy (75) gate is not claimed as a browser pass.

## Freeze after menu placement completes

The first loaded Linux cohort found a fixture deadlock in one of five repetitions: a late camera refinement arrived after the initial idle check, and opening the storefront then waited for that refinement with the frame clock already paused. The other 114 executions passed. The pause now happens after the storefront has opened and requested the gated script. Simulation time is still captured before opening the menu, so the original exact freeze assertion remains. There is no camera operation after the pause. Native positive/negative checks and a fresh five-repeat loaded cohort verify the ordering without changing deadlines or tolerances.
