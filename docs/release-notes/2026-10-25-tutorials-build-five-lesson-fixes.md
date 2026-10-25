## Tutorial lesson fixes (PR #303, round 1)

The Config lesson first helps show hidden Dependencies. Adding and locking
Notifications:Token now follows its key even when it is inserted before existing
settings; Skip preserves the other settings. The lock coach mark follows that same
key. Updated lesson versions restart incompatible saved progress.

The partitions lesson keeps its idle-consumer instruction until Done. The outbox
lesson separates choosing the happy-path simulation from reading its paused note:
Continue stays available, then Done advances to compensation. Both reading steps
retain Skip and resume paths through the existing runner.

Regression coverage checks hidden Dependencies, reordered settings, intro-time idle
metrics, narration actions individually, and the SMS queue's connection to the
sender paused by the outage simulation (rejecting email and push bindings).

The only changed parity golden is `node/i18n/catalogs.json`: four added tutorial
messages increase message and fallback counts, and the revised tutorial instructions
change the tutorials-area hashes. The other two i18n goldens remain unchanged.

The webhook paused-note finding R-f0c5f5cc15 remains deferred to the separate runner
change that adds `continueNote`.
