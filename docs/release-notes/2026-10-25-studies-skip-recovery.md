## Fan-out Skip recovery and RAG answer safety (PR #347, round 1)

Fan-out's reference repair now fixes saved-run connection-pool overrides before replaying both
provider limits and the SMS outage. Other caller settings are preserved. Channel queues bind by
their sender connection, so Skip reconnects a missing incoming connection and reuses the queue
and its dead-letter queue, including when the dead-letter queue was created first.

RAG's answer-budget milestone rejects failed answer-path calls, including caller timeouts that
would otherwise look like fast answers while the model continues working.

No parity goldens changed. This fix round runs the tutorial unit tests, completion sweep and
production tutorial browser spec; full-suite and parity validation remain for CI.

The tutorial unit run encountered the existing backoff-budget sweep timeout, reproduced twice
in isolation on clean origin/master and recorded in the dated backlog fragment.
