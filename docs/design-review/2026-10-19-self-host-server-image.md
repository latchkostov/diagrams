## S4 deployment UX review

No editor controls, consent wording or public-site behavior change. The server image keeps the internal
profile's privacy defaults and compiles collaboration to the same-origin relay. One image and one compose
service are the default; relay-only deployment stays an explicit operator choice.

Proxy variants preserve the requested base path and delegate security headers to the server. Their
comments identify the public-origin and base-path settings; relay-only snippets identify `LD_STATIC=off`.
Healthchecks work without shell tools or writable storage. Separate CI step names identify static-image
and collaboration-server failures, and the smoke output reports the compressed size and its limit.

Rejected adding a runtime configuration endpoint, database, Helm server mode or publishing step: these
are outside S4 and would introduce new deployment contracts. The existing static image remains unchanged.
