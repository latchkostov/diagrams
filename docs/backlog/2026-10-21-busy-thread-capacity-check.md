## Reconcile initial capacity with verified busy-thread scaling in PR 5

After applying the verified Scale on busy threads suggestion, scenario sizing
clears and playback drains, but the existing static capacity rule can still warn
that the initial four-pod fleet is undersized. It measures initial capacity rather
than the controller's eventual fleet. Keep that distinction explicit when adding
the PR 5 scaling-blind / blocked-thread Checks, without suppressing genuine
startup backlog, memory, binding or maximum-capacity problems.

The new example regression pins both the verified rerun and the remaining initial
capacity warning. No existing capacity assertion is weakened for older fixes.
