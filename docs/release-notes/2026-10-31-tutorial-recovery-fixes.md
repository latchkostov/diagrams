## Tutorial recovery fixes (#406, round 1)

Author a Drill now repairs a Slow dependency step with the wrong target or time in place when Skip is used. Unrelated timeline entries and the learner's other settings stay intact. Completion and repair share the same fault predicate.

Make a repeatable experiment resolves the expected Worker processed ≥ 10 at the end by its definition, so adding two expectations and deleting the first still permits both result and replay completion. Their result must belong to the matching expectation.

Trace slow motion rewinds an already-finished journey before capturing the next-hop baseline. Both Right arrow and Skip remain reachable after playback finishes while the learner reads Pause. Read a node now advertises only the Properties route that its completion check accepts.

Mutation checks restore each previous behavior and verify its regression fails. Browser regressions cover saved wrong-target/time Drills, adding two expectations and removing the first, and both hop routes after finished playback.

The only changed golden is `tests/parity/goldens/node/i18n/catalogs.json`: the `en-XA` tutorials digest changes because the unsupported hover alternative was removed from the English readout instruction. No simulation or visual output golden changes are intended.
