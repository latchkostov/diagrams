# Autoscaling A3 review round 2 (2026-10-16)

The seven-angle review of the round 1 fixes (`--since 7ef0e083`, `.reviews/20261015-233723`) reported no P0 or
P1 and eight P2 entries, three distinct issues plus one design objection. The review loop stops here (a round
with no P1).

| Finding                                                                                                 | Resolution and regression                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cancelling `describe_diagram` or `check_diagram` while sizing was pending still answered (five reports) | The sizing wait takes the call's signal and rejects on abort; `check_diagram` checks it again before starting playback. Test: cancelled while the worker's plan is pending, each of describe, check and check with simulations replies "The call was cancelled.", without the diagram, and plays nothing. |
| The worker planned even with the capacity check turned off (two reports)                                | The worker returns plans only when the capacity rule ran (memoized: no extra run); the main-thread fallback plans only when capacity is on. Test: with capacity off, no simulation plays and no plans return; with it on, the max 14 plan returns.                                                        |
| The agent tools waited for sizing their reply couldn't use                                              | `describe_diagram` waits only where it analyses the graph (≤ 200 nodes, ≤ 500 connections); `check_diagram` only when the capacity rule is in the reply. Test: a dead-letter-only check doesn't ask the planner.                                                                                          |

Rejected with reasons: passing plans explicitly into `runChecks` and `describeDiagram` instead of reading the
editor's remembered worker results. Round 1's P1 was exactly that a main-thread caller ran simulations; with the
registry, every main-thread caller (present or future) is safe by default and can't run one, while passing plans
would make each new caller responsible for remembering to. Headless callers are unchanged and deterministic; in
the editor the agent tools wait for the worker before checking, so agents never see a half-done result. The
`runChecks` contract now says sizing in the editor comes from the worker.
