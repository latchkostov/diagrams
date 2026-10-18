## Self-host server review fixes

Static responses reuse Brotli/gzip variants in a 32 MiB, 256-entry LRU keyed by file metadata and encoding.
Brotli uses explicit quality 4. At most two compression jobs run at once, with an 8 MiB input limit;
requests fall back to identity when busy or oversized (406 if identity is forbidden).

The server selects embed framing permissions from parsed query parameters, anchors the app's cached
index HTML to `LD_BASE` for deep links, and redirects directory indexes to their trailing-slash URLs
while preserving queries. Missing script Cache-Control policies fail validation at startup.

Current room distribution is now `rooms_by_size{size="N"}` gauges, bounded by `LD_ROOM_CAP`, replacing
the misleading `room_size` histogram. Dashboards using its former buckets/count/sum must migrate.
Regression coverage independently fixes the minimum session-frame boundary and protects HTTP responses
and incomplete HTTP connections through the drain deadline.

No parity goldens change; diagram, simulation, export and rendering output are unchanged.
