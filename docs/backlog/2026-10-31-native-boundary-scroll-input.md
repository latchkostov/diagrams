## A boundary is not an input acknowledgement

Latency's embed overflow case repeats in baseline Nightly 41245495563 and diagnostic 41249763740 on macOS, and in the diagnostic Windows run. Home must reach exactly zero; the macOS diagnostic retains a two-pixel offset. Its trace sends a second wheel while already at the bottom, focuses the card, and immediately sends Home.

The scroll helper previously resolved immediately at an existing boundary even though Playwright's wheel command can return before native event delivery. It now observes the actual wheel or keydown and lets that event's browser frames commit before accepting its scrollend or unchanged boundary. A scrollend preceding this input is discarded. Event listeners and pending animation-frame work are removed on completion or cancellation. All existing exact boundary assertions remain unchanged.

A deterministic browser regression enqueues a boundary gesture without delivering it. The helper must remain pending, then accept the real wheel even though no scrolling is needed, and permit the subsequent Home to reach zero. Temporarily restoring the old helper fails before delivery. Five final-source Windows repetitions of both regression paths and both embed/presentation cases pass 20 executions. Linux repetitions are recorded in the verification fragment and PR.

No product scroll behavior, tolerance, timeout or gesture count changes. Increasing the allowed offset or inserting a timed sleep was rejected.
