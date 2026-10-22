## A continuation whose hold has expired loses its request's replica

Found while fixing the review of #233. A continuation that takes over its own retained thread keeps that thread's physical ownership: the same replica ranges and drain deadlines, so termination grace still applies. A continuation whose hold had already expired gets nothing to take over. It queues, and is admitted with fresh CPU parts on ready replicas.

So after a replica shrink, the same request can fail at grace (hold still running) or escape it on a ready replica (hold expired). A probe at scale 4 and 10 had a one-slot caller with a blocking call and a non-blocking side call with a 200 ms reply, and shrank two replicas to one at 40 ms with 100 ms grace. With holds, the continuation failed at 140 ms. With the I7 probe's `ledgerHold: "none"`, it succeeded at about 300 ms. Master e347bd03 shows the same split.

The I7 property generates no replica changes, so it does not reach this; in steady fleets the outcomes agree. Fix: keep the request's last physical ownership (or its drain deadline) on the work when its hold expires, and let the continuation inherit it on admission. Then add a replica-shrink action to the I7 property.
