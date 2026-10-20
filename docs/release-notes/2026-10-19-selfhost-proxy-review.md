## Self-host S4 proxy and healthcheck review fixes

Both generated nginx relay variants append the observed client address before forwarding, so rotating
a caller-supplied `X-Forwarded-For` prefix cannot bypass per-IP socket admission with the documented
one-hop trust configuration. Caddy retains its safe forwarding defaults. Compose exposes the opt-in
trust settings; the hosting guide explains proxy-only reachability and matching trusted-hop counts.

The distroless healthcheck follows the configured listener, including IPv6 and wildcard binds.
Deployment smoke coverage now sends real bidirectional WebSocket traffic through nginx and Caddy
at root and subpaths, with static serving on and off, and checks rejected origins and spoofed-IP quotas.
No parity golden changes are intended: diagram, simulation, export and browser output are unchanged.
