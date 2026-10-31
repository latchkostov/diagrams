## Use verified readiness for the replica keyboard path too

Nightly 41205930112, Windows shard 3, fails the Arabic replica-alternative case before applying anything: the verified alternative does not exist within its existing enabled assertion. This path still opened Checks directly, unlike the primary keyboard setup already converted to the actual background-check completion signal.

Route replica preparation through that same helper. The held-real-worker regression now exercises both preparation paths, proving Checks does not open early and the canvas remains keyboard-usable. The original replica count, fixed-fleet policy, translated label and complete Undo checks remain unchanged. No timeout, tolerance, worker response or application change.

The complete file passes 38 native Windows and 38 Linux executions, two repetitions each. Temporarily restoring direct opening in replica preparation fails its new regression with `opened=true` while the real result remains held; the tested bytes are restored afterward. All 25 replica/preparation executions pass in the five-repeat, eight-worker/four-CPU cohort. Its broader 130 executions have 127 passed and three failures in the separate, unchanged inspector-Tab path: the trace presses Tab before the lazy diagram fields render. That follow-up is handled independently; no failure is reclassified or quarantined.
