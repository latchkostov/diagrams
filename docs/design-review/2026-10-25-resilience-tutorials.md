## Resilience lessons UX review

Reviewed the four lesson declarations against existing inspector controls and the tutorial
completion contract. No chrome or new controls are added. Edits name Simulation, Retry timing,
Wait before retrying, Retry budget and Circuit breaker as the app does. Saved runs supply the
comparison, and each completed step explains what it means in one sentence.

The review caught an early-latching failure reading: the callee fails before its backlog grows.
The waiting step now asks the learner to inspect the caller's pending calls, so Failed can be
observed during the brief Fault. A regression drives both moments through the real controller.
Expectation steps target the dots or their responsive summary, whichever is visible; the solution
watches from the timeline, which stays visible at either width. Recovery requires a Closed reading after 15 seconds, rather than the
initial Closed state completing the lesson before the breaker opens.

The rate-limit lesson remains unavailable pending owner decision 4 and a Rate limit control
for the Rate Limiter stencil. Its seeded inline portion is tested without presenting it as a
complete lesson. The runner, focus policy and app components are unchanged.
