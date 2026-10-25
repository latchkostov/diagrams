## Fan-out and RAG quarantine UX review - PR #339

The existing quarantine mechanism removes both studies from discovery and next-lesson suggestions,
and handles their deep links as unavailable. Saved progress remains on the device for restoration.
This avoids directing learners into milestones that reject valid fan-out construction or accept an
invalid answer-latency result. No controls or new UI text are added. Cells remains discoverable and
its membership-based boundary lesson stays unchanged. Runner changes and milestone fixes are deferred
to the restoration work recorded in the quarantine backlog.
