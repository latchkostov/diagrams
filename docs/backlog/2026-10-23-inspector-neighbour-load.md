## Inspector failures in the neighbouring load sweep

The CI-flake branch's Linux neighbour sweep used eight workers/eight CPUs and
`--repeat-each=5` across ten specs. It completed with 840 passed and five failed,
zero flaky cases and zero skipped. Both requested browser regressions passed.

Three failures in `inspector-resize.spec.ts` reached the seven-second wait for
`routes-table` in its shared double-click setup: cancelled pointer resize, Enter
without continuing narration, and right-to-left resize. Its slow-motion arrow-key
case reached the seven-second replay assertion while Play was paused/disabled.
`inspector.spec.ts`'s P1 sampling-scale case hit the 30-second whole-test backstop.

The sweep ran on the branch based on `8c8a7f32`. Only those two inspector specs were
then replayed twice from an immutable clean `origin/master` archive at
`87e75d9337fbfe61b3c5446e11ee46c4232e6e3d`, with the same worker/CPU settings:

`SUMMARY: 87e75d9337fbfe61b3c5446e11ee46c4232e6e3d | unit="not run" parity="not run" e2e={"passed":36,"failed":0,"flaky":0,"skipped":0} gate_failures=0`

The failures did not reproduce in that focused replay. Runner pressure is a
possible explanation, not a proven cause or proof that these failures predate the
branch. The inspector specs and their assertions remain unchanged. The branch was
synced to that latest master before its final focused checks. Investigate the
double-click setup, capture readiness and expensive sampling fixture separately;
do not raise timeouts or add retries to hide them. No full clean-master suite ran.
