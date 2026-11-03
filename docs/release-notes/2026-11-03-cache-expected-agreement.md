## Expected agrees with Live at caches

Expected and Inputs retain the configured response time when estimating cache hits. Plain gateways and stores still have unlimited throughput in planning; making their capacity unlimited no longer makes their fetches instantaneous. The review fixture (200 requests/s, 20 evenly requested items, a one-second TTL, a 60 ms fetch) now predicts 86.2069% hits. Live measures 85.40–86.025% across seeds 1, 7, 17, 42 and 99 over simulated seconds 40–60, instead of comparing those measurements with 90.0901%.

The expanded agreement gate keeps the original assertions and adds popularity, item count, TTL, fetch duration and rate coverage at scales 1 and 10. It found two further simulation cases: short freshness intervals below the clock's useful resolution now use the statistical formula when a starting rate is available, and duplicate replies cannot refill a later expiry cycle. Healthy statistical availability is renewed by active traffic, cools across idle gaps, and stops renewing after a failed fetch. No checkpoint field or budget changes.

Black Friday's four-second note describes the caching benefit qualitatively while its traffic changes. Cache details explicitly distinguish the recent window (up to ten seconds) from rule totals since restart. The run-end lesson identifies its cumulative hit ratio and average rates since restart.

## Output parity

Nine authorized goldens changed: Black Friday's native diagram, draw.io XML and metadata, Interactive HTML metadata, agent describe and edit results, skill share-link metadata, and doors-open note/event output carry the revised narration. Export byte counts and hashes change with that text. The global pseudolocale catalog hash records the measurement-scope wording. No browser drawing golden changed.

Six synthetic cache-corpus planning goldens also expose the original latency-loss bug. They remain unchanged pending the owner's decision about the task's golden restriction.

## Agreement validation

Steady state is simulated seconds 40–60. The original gate and its 5% fetch-share bound remain intact. The added property sweep covers 20–20,000 items, all four popularity presets, 100 ms–30 s TTLs, 10–1,510 ms fetches, and 200–2,000 requests/s at scales 1 and 10. Each case uses at least five seeds and 10,000 sampled dots, pooling independent 20-second windows without increasing either percentage-point bound.

With CI seed 20261018, the new sweep's largest errors against the old planning inputs are 4.0582 points at scale 1 and 3.9232 at scale 10; corrected inputs reduce these to 0.6295 and 0.4945. The 1,510 ms fetch / 1 s TTL regression previously measured 68.985% for 20 even items against a correct 38.3142% prediction; rejecting replies from old fill cycles yields 38.465% across seeds 0–4.
