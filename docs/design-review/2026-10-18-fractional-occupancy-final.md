## Fractional occupancy and work-budget recovery

The existing Live status notice announces the translated budget explanation and a concrete recovery hint.
Playback visibly pauses and preserves its current published counters. Restart and Inputs & capacity stay
available; recovering and playing again uses the surviving frame loop. No new control uses chrome budget.

Successes and failures hold sampled caller capacity consistently, including endpoint and shared allocations.
Renewed admission updates both occupancy and the selected endpoint's service time for retained retries.
Outages and forced teardown still cancel immediately. Historical simulation revisions retain their behavior.
Ramp startup avoids repeated full-stage scans without changing runtime integration.

The production-browser regression raises Traffic during playback, checks the accessible paused notice,
changes the input, restarts and verifies clock progress with no page errors. Fake-clock progress tests behavior
without an elapsed-time performance budget. Unit comparisons use real counts and one sampled dot of tolerance.
