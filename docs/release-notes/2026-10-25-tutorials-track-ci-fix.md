## Building blocks track and gateway recovery

The exact Building blocks order is API gateway, Kafka topic, Queue workers, Load balancer,
Cache aside, Webhooks, Fanout, Partitions, Outbox, then Dependencies part 2 (Config settings).
The registration test now includes the restored Config settings lesson. The split rate-limit
and shared API quotas lessons remain in Resilience, as designed.

Insert on an edge now removes a remaining direct bypass with the editor's scoped deletion
command, preserving the selected gateway for the following naming step. Regression tests
also assert that existing upstream, downstream and paired connections retain their IDs,
labels, kinds, relationships, attachment sides and simulation properties through Skip.

No output or parity golden changes are intended. This fix round runs the tutorial unit tests,
including the completion sweep, and the production-build tutorial browser spec; full-suite
and parity verification remain with CI.
