## Self-hosted collaboration server (S1–S5)

Run Edit together entirely on your infrastructure with one image serving the UI and an encrypted WebSocket
relay. Server mode uses no public trackers, WebRTC, STUN or TURN and never falls back to them. The relay sees
connection metadata and encrypted frames, never diagrams, presence content or room keys. The operator serving
the UI is still trusted to publish honest JavaScript.

`VITE_COLLAB=off|public|server` chooses the build's transport; `VITE_ENABLE_COLLAB=1` aliases `public`.
Rooms are independent of share links. Private diagrams remain blocked in every mode with no escape hatch.
Server failures explain unreachable/full rooms; browsers reconnect and resync after restarts. There is no
server persistence or built-in authentication: put the site and relay behind SSO or a VPN.

The hardened non-root, read-only server image supports Compose, nginx/Caddy full-site and relay-only layouts,
and Helm `mode: server`. Helm pins one replica with `Recreate`, wires runtime settings and health probes,
and supplies nginx-ingress WebSocket timeouts. Static mode renders exactly as before. Images are built and
smoke-tested in CI, not published to GHCR. See [SELF-HOSTING.md](../SELF-HOSTING.md#collaboration-server)
for settings, proxy trust, TLS, access control, upgrades and troubleshooting.

The proxy smoke now checks real app content and independent per-IP quotas for distinct client containers,
alongside spoofed forwarding headers, bidirectional frames and log hygiene. S5 changes no application output;
every output-parity golden is unchanged.
