## Observe the paused setup stage before testing its held worker

Nightly 41190929111, Windows shard 7, exposed a race in the new held-verification regression. Its concurrent outer clock assertion started before navigation and eight timeline seeks. That assertion expired at 13 seconds, while the helper was still executing the final seek. The trace shows the final focus finishing at 600852 ms and the helper's identical 15000 clock assertion passing at 600921 ms. The helper's verification wait was correct; the concurrent observation had started at the wrong stage.

The helper now signals its paused stage immediately before waiting for the real worker response. The regression waits for that signal, or propagates a setup failure, before observing the held response. The exact clock, paused state, pre-response Events action, unfinished helper and post-response Add timeout assertions remain unchanged. No timeout or budget changes.

## Loaded CPU ratio remains enabled

The separate five-repeat Linux cohort for cancellation, camera, Undo, worker counters and UI neighbours completed with **58 passed, 2 failed**. All five cancellation cases and all geometry/counter regressions passed. Both failures were the original worker-versus-main CPU ratio assertion: one median was 4.004 ms against a 3.449 ms limit. Its original 0.8 ratio is unchanged; no test is skipped or quarantined. The renderer's production two-repeat Windows and Linux cohorts passed earlier. This additional oversubscribed CPU comparison is a remaining measurement/performance investigation, not evidence for a platform exemption.
