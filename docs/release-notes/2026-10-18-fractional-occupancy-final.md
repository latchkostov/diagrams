## Fractional caller occupancy: final corrections for #189

Sampled callers retain capacity for failed downstream replies and local failures as well as successes.
Retained retries start a fresh residence interval for each attempt, using the renewed reservation and
the endpoint's actual service time while preserving progress earned during backoff.
Admission, residence and release now share the admitted reservation, including binding endpoint and shared
concurrency allocations. Changing messages per dot to 1 lets outstanding sampled callers drain.

If a live Traffic increase exhausts the scripted work budget, playback pauses, publishes the current state,
and announces: “Too much traffic for this sampling; restart with more messages per dot.” Seek, replay,
Continue and slow-motion look-ahead handle the same refusal without losing the animation loop.

Startup traffic-volume calculation integrates ramp stages in one pass. Runtime ramp integration retains
its existing calculation. Full-weight rejection of a batch that fits a partial allocation was rejected:
the admitted fraction instead incurs the corresponding longer residence.

Regression verification includes temporarily restoring the previous implementation: the new failure,
allocation, scale-change, ramp and controller tests fail before the corrections.

Only `tests/parity/goldens/node/i18n/catalogs.json` changes: the new recovery notice adds one English message,
one fallback in each untranslated catalog and the corresponding Live-session hashes (including the pseudo-locale).
Every older-revision and W1 golden remains unchanged; no simulation output is re-recorded.
