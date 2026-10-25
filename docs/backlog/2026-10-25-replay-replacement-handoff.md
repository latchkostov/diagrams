## Replay replacement handoff regression (PR #341, R-5656abfb2f)

Add a successful latest-request-wins test to `src/live/session/traceFacade.test.ts`.
Issue distinct pending sources, attach a service while blocked, then unblock handoff.
Assert one start with the second source and the first request's viewport, and restoration
of the original playing state. Current replacement coverage cancels before attachment.
