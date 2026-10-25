## Resilience tutorials: health checks, dead letters and load shedding

The Tutorials preview adds Health checks, comparing the existing zone-outage Drill with and without health checks.
It waits for real dropped requests in the unprotected run, then for the protected run to finish while the surviving
zone serves traffic. Down targets count arrivals as dropped, rather than failed processing attempts.

Two catalog drafts remain unavailable pending owner decisions: Load shedding (item 5, earlier decision 10: the
explicit shedding setting and spike interaction) and Dead letters (item 6: replay from the DLQ). Their authored
steps cover a seeded overload and backlog, and poison messages, dead-letter counts and Max deliveries. Neither
draft substitutes a pending interaction or claims to teach replay or rejection yet.

No simulation engine, public example or app control changes. Existing public examples already show health checks
and dead letters; the overload draft uses an invented inline diagram. All new tutorial words use English catalog
keys, with the existing English fallback in other languages.

The only intended golden change is `tests/parity/goldens/node/i18n/catalogs.json`: 41 added English tutorial
messages increase the catalog and fallback counts for all 37 other languages and change their `tutorials` area
hash. The pseudo-locale gains the same messages and a new tutorial hash without additional fallbacks. Existing
plain-text translations are reused, so fallbacks rise by 39 in Arabic and 40 in each other language. Existing
message rendering, all other areas and every simulation/output golden stay unchanged.
