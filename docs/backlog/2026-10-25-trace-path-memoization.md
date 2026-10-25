## Preserve trace-path memoization (PR #341, R-c191348e50)

`useTraceSpotlight` depends on the fresh runtime result, rebuilding an unchanged Live
journey during replay publications. Expose a stable journey builder with an explicit
readiness dependency, or cache the journey inside the downloaded adapter. Add a call-count
regression proving replay ticks do not rebuild unchanged trace/diagram inputs.
