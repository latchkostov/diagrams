## A paused page clock does not complete worker verification

Both native Windows baselines reach the expected trouble but still offer Events when a test expects the verified thread fix. Advancing or seeking the page's fake simulation clock does not run the checks worker's real download or replay. The callout intentionally keeps Events until verification finishes.

The affected owner/callout setups now wait for the actual worker request and response protocol before asserting the unchanged action, planner agreement, keyboard application and Undo results. The test-only probe preserves both postMessage transfer overloads, handles worker errors and synchronous post failures, and observes a real task boundary after replies so a stale flight's replacement cannot be mistaken for completion. It waits for the cold verifier's first request too. It does not infer success from worker completion: the existing exact fix assertions still decide that.

A deterministic Windows regression holds the first real verification request while setup reaches 15 simulated seconds and pauses. The original setup returns before release (**1 failed**); the repaired setup remains pending, releases through the real worker and still requires Add timeout. Six unit cases cover cold startup, transfer preservation, latest-flight replacement, independent workers, failure cleanup and idempotent release. No application, replay, verifier result, timeout, tolerance, oracle or golden changes are introduced.

Final native and Linux results are recorded in the verification fragment and PR. These changes do not establish that every worker-painting or recording observation has this cause.
