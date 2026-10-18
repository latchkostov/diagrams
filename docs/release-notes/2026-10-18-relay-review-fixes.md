## Relay resource and admission fixes (PR #176)

The optional relay now reserves a shared outbound byte budget before data and control writes,
including framing and eviction closes, and releases reservations on completion or close.
Slow recipients cannot exceed the aggregate cap. Origin and socket limits reject requests with
HTTP 403/429/503 before upgrading, preventing refused sockets from accumulating.

Trusted proxy identity uses the configured hop from the right (`LD_TRUST_PROXY_HOPS`, default 1).
Ingress must append observed addresses. Startup rejects payload limits too small for the fixed
session frame/fragment contract. The browser advertises and enforces the negotiated frame limit
and discards drained receive accounting.

Regression coverage includes a 1 KiB shared budget, repeated refused upgrades, spoofed proxy
prefixes, real cross-room delivery isolation, healthy pongs and populated reconnect membership.
No parity golden changes are intended or recorded.
