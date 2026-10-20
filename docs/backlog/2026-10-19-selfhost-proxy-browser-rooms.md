## Browser collaboration through self-host proxies

PR #210 review follow-up: extend scripts/server-deployment-smoke.mjs with a separate browser-room
scenario for nginx and Caddy at both / and /tools/diagrams/. Start and admit a second browser, edit
in both directions and assert delivery, collecting securitypolicyviolation events as well as pageerror.

The current deployment matrix deliberately limits each observed IP to two sockets for the spoofed-XFF
quota regression. Browser lobby and content sockets need a separate relay configuration with enough
quota. Keep the existing quota assertions intact. This requires a second Docker deployment scenario
and its integration run, so it is deferred from the rollout/memory review fix. Direct-server browser
rooms and proxied Node WebSocket relay traffic already have smoke coverage, but do not close this gap.
