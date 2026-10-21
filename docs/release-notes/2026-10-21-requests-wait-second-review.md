## Waiting-request sampling corrections

Fleet construction now requires Concurrency, including Capacity × changes before playback and resource reinitialization. Equivalent load at sampling scales one and two reports 61.875% busy threads at Capacity × 2 and keeps eight replicas instead of incorrectly growing to sixteen.

Connection-pool acquisition captures the thread's fractional admission carry before local-work bookkeeping advances its segment clock. Completed local work cannot backdate a newly ready call: the regression acquires at 380 ms rather than consuming credit from 372.6 ms.

## Validation and scope

Both regressions fail when the corresponding fixes are temporarily reverted. Existing assertions and sampling-accuracy pins remain unchanged. The shared factory's unit callers explicitly declare their concurrency; no new controls or simulation features are added.

The targeted tests pass (402), as does the complete unit suite (13,418 passed, seven existing expected failures, four skipped). The sweep passes all 137 distinct seeds: 100 fresh at 5×, ten fresh at 20× and 27 historical pins at 5×. Build, entry/viewer/Forge size budgets, regeneration and i18n validation pass.

## Output parity

All 2,897 goldens match: zero changed, added, missing or stale. No master golden or PR golden is re-recorded. The generated skill viewer is refreshed for the corrected engine.
