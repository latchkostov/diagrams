## Viewer autoscaling coverage and capacity tutorial checks

Production browser coverage now exercises busy-thread autoscaling in the static viewer bundle,
the installed skill viewer and the freshly built Interactive HTML viewer. It checks desired,
starting and ready replica growth, the fleet/resource readouts and a recorded simulation replay
that starts again with one replica and grows while recording.

The tutorial solution driver reads the runner's current phase, step and solution together. A
tutorial finishing between browser reads can no longer produce an empty step ID and an impossible
wait for that finished step to change. A controlled browser regression exercises that interleaving.
The capacity lesson also waits for its seeded saved simulation's Live session before pressing
Start, so the initial lazy startup cannot race the solution's Live toggle.

Mutation checks stubbed the autoscaling runtime evaluator in both viewer builds: all three artifact
tests failed because desired replicas stayed at one. Restoring the old tutorial driver reproduces
the completion regression. No sleeps, retries, timeout increases or weaker assertions are added.

These are test changes: application behavior and output goldens are unchanged. No golden is updated.
