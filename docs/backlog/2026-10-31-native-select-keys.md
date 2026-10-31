## Native select keyboard choreography

The same four macOS cases fail in both [41167179188](https://github.com/latchkostov/diagrams/actions/runs/41167179188) and [41168472337](https://github.com/latchkostov/diagrams/actions/runs/41168472337): phone Speed in review-358, and the expectation metric picker in requests-wait-checks for en, ar and en-XA. Before: **8/8 executions fail**. The selected value remains 1 or threadsBusy after the test sends navigation keys to a closed native select and then Tab.

The initial experiment opened the native popup with Space, navigated with the original End or ArrowDown, committed with Enter, then Tab. Windows and Linux passed eight executions each, but native macOS still failed. That experiment is rejected and the original tests restored. The phone test still independently requires uncancelled navigation defaults and focus, and all exact value assertions remain enabled.

The final boundary and proposed decision are in `2026-10-31-native-select-platform-decision.md`. Application output is unchanged; no golden is re-recorded.
