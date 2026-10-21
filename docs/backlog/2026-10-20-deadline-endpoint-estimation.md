## Share endpoint-aware response estimation (#197 review)

Extract a shared connection response estimator into `src/sim/timing.ts` for waiting planning
and timeout suggestions. Include the selected endpoint, downstream residence and network delay.
Currently a 250 ms API default with a 5,000 ms selected endpoint can suggest a 1,000 ms timeout.
This round only caches the existing fallback estimate; changing its meaning is deferred.
