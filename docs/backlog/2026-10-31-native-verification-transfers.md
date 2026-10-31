## A verification observer must preserve worker transfers

The remaining Windows `requests-wait-review` held-flight case exceeded its whole-test deadline. Both inline observers in that spec forwarded every Worker message with `[]`, discarding the caller's transfer list. The wrapper also intercepted unrelated renderer initialization: OffscreenCanvas must be transferred, so the observer could force the application onto its main-thread fallback. This is a harness defect, not evidence that production verification needs a larger budget.

Both observers now use the shared transfer-preserving probe. It records the same real verification request objects and can hold the first request; the existing exact single-flight count, latest revision, replayed Continue and timed Capacity configuration assertions remain intact.

A new native Windows regression exchanges real ArrayBuffers with a same-origin worker using both postMessage overloads. Reinstating the old empty-list forwarding makes both buffers remain 16 bytes on the sending thread instead of detaching: **1 failed**. Restoring forwarding transfers ownership and preserves the worker's exact 16-byte receipt. The worker is terminated in cleanup. Probe units also require recording the original request details without changing unrelated traffic.

The complete spec's native and Linux two-repeat results are recorded in the round-two verification fragment and PR. No application, worker protocol, simulation, timeout, tolerance, assertion budget or golden changes are introduced.
