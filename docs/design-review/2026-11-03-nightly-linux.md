## Scope

This repair changes test readiness and benchmark observation. It adds no controls and changes no camera, simulation or collaboration behavior. Existing hit-test, off-pane, Inspector-reveal, RTL target priority and exact-state assertions remain.

## Review

The coach correctly falls back to the canvas when Simulation is off-screen. The test previously scrolled that disclosure while the description editor and configured-planning section were still loading above it. Their arrival invalidated that scroll. Waiting for those rendered sections, then the disclosure's stable box, observes the layout the test actually uses without changing a learner's target priorities.

The benchmark must observe actual camera readiness as well as stable geometry. A steady transform while deferred work owns the camera does not make the next click safe. Pane bounds and transform now come from one browser task. Each input still waits for the camera and two equal geometry samples. A Fit requested immediately after an idle-camera sample does not repeat that same preparation.

Benchmark regression setup uses the existing performance fixture to retain action traces and failure PNGs without recording an entire 100-node DOM snapshot around every helper call. Its assertions and workload are unchanged. One shared Bench fixture also retains the correctly initialized DevTools session instead of creating an unused second session in each test.

## Rejected changes

Increasing deadlines, weakening coach expectations, changing camera rules or reducing the workload would hide the observed races or observation overhead. An extra viewport test id changed exported SVG metadata and was removed instead of updating goldens. No retry, skip, quarantine or tolerance is introduced.
