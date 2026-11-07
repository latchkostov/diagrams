## Cold-cache Checks keep each caller's own origin

When services share one cache and their lookups look alike, cold-cache Checks no longer project
their combined traffic onto every caller's origin. With 300 requests/s from one service and 30
requests/s from another, each fetching from its own database, the second database's cold-start
warning reports 30 requests/s and sizes six replicas for a 10 requests/s service, instead of
330 requests/s.

The projection is now recorded by the same pass that propagates demand, which also corrects
CDNs that split across an asynchronous feed or route around an unhealthy origin, renamed lookups
with message-type filters, and request filters on caller origin calls. A table and property test
compares the projection with cold-cache propagation across these topologies. No parity goldens
change.
