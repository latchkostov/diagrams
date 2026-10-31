## Native select keyboard choreography

The same four macOS cases fail in both [41167179188](https://github.com/latchkostov/diagrams/actions/runs/41167179188) and [41168472337](https://github.com/latchkostov/diagrams/actions/runs/41168472337): phone Speed in review-358, and the expectation metric picker in requests-wait-checks for en, ar and en-XA. Before: **8/8 executions fail**. The selected value remains 1 or threadsBusy after the test sends navigation keys to a closed native select and then Tab.

The tests now open the native popup with Space, navigate with the original End or ArrowDown, commit with Enter, then Tab. The phone test still independently requires that every synthetic navigation key's default action remains uncancelled and that focus stays on the select. The exact final values, translated words, keyboard paths, deadlines and tolerances remain unchanged. No selectOption substitution, skip or product key-handler change is introduced.

Native macOS verification requires the branch Nightly; local Windows and Linux checks alone cannot establish the macOS repair. Results are recorded in the round-two verification fragment and PR. Application output is unchanged; no golden is re-recorded.
