# Self-hosted UI and collaboration relay (S1–S2)

`services/server` is an optional Node 24 workspace package. Its only runtime dependency is `ws`.
It forwards existing encrypted collaboration envelopes; it imports neither Yjs nor crypto. There
is no document storage, authentication provider, Docker image or production client switch yet.
S2 adds UI hosting and operational endpoints. The public application's import graph does not
reach the relay transport. Dev and e2e harnesses can import `createRelayTransport` directly;
build-mode selection waits for S3.

## Boundaries and protocol

`src/collab/transport/relayProtocol.ts` defines the DOM-free shared contract and limits, derived
from `COLLAB_LIMITS`. The endpoint is `<base>collab/v1`, with subprotocol
`livediagrams.relay.v1`. A text `hello` carries version 1 and the 43-character HKDF room ID.
The URL must contain no query or fragment. Neither the secret nor a link is sent to the server.
`welcome` assigns a 16-hex peer ID, lists existing peers, and advertises capacity, maximum
envelope size and `durable: false`. Membership changes use text `join` and `leave` messages.

Client binary frames are `0x00 | envelope` for broadcast or `0x01 | 8-byte peer | envelope`
for addressed delivery. Server frames are `0x00 | 8-byte sender | envelope`. A peer cannot
address another room or spoof its transport sender. The server can observe membership, timing,
frame lengths and the existing clear envelope header; document and presence contents remain
encrypted. The browser session continues to authenticate envelopes and heal missing updates.

`Admission` owns Origin checks and per-IP counts. `RoomRegistry` owns membership, bounded
room creation and immediate empty-room deletion. The connection state machine owns hello,
byte/frame token buckets, framing, backpressure, ping/pong and idle cleanup. Those seams allow
later authentication or a shared registry without teaching the relay about document content.
Origin, per-IP and total-socket admission run before WebSocket upgrade. Refusals return plain
HTTP 403 (Origin), 429 (per-IP), or 503 (capacity/draining), then destroy the connection;
refused requests never enter the WebSocket client set. Browser clients see a failed connection.
Close codes after upgrade are 4000 (protocol/hello timeout), 4008 (room/room-count cap),
4029 (rate/backpressure), 1009 (size), and 1012 (restart). 4003 remains reserved for Origin.

One server-owned outbound budget reserves bytes before every data, membership, ping or pong
write and releases them on its callback or socket close. Accounting is O(1) per recipient,
includes WebSocket framing, and reserves 127 bytes per admitted socket for a maximum-size close (including an automatic reply
echoing a peer's close reason).
Backpressure evicts the recipient with 4029 using that reserved close; no new sends are queued
for it. The byte limits must each allow at least that 127-byte reservation.

## Running and configuration

Run `pnpm build` and `pnpm --filter @livediagrams/server build`, then
`pnpm --filter @livediagrams/server start`. esbuild emits one ESM file with `ws` external.
The default listener is HTTP on `0.0.0.0:8080`; TLS belongs at the reverse proxy. Run behind
your SSO or VPN. Origin checks and resource limits do not replace access control.

All configuration is read once and validated before listening:

| Environment variable                                                 | Default / meaning                                                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `LD_HOST`, `LD_PORT`, `LD_BASE`                                      | `0.0.0.0`, `8080`, `/`; base starts and ends with `/`; port 0 supports tests                                                                   |
| `LD_ORIGIN`                                                          | Public HTTP(S) origin behind TLS termination; otherwise request HTTP origin                                                                    |
| `LD_ALLOWED_ORIGINS`                                                 | Additional exact HTTP(S) origins, comma-separated; missing/null Origin is refused                                                              |
| `LD_TRUST_PROXY`                                                     | `0`; only `1` enables trusted proxy resolution; restrict direct access to trusted ingress                                                      |
| `LD_TRUST_PROXY_HOPS`                                                | `1`; positive integer; choose the Nth `X-Forwarded-For` address from the right                                                                 |
| `LD_LOG_IPS`, `LD_METRICS`                                           | `0`; boolean settings accept only `0` or `1`                                                                                                   |
| `LD_STATIC`, `LD_STATIC_DIR`                                         | `on`, repository `dist/` resolved relative to the server module; override the directory for a packaged deployment; `off` needs no static files |
| `LD_DRAIN_TIMEOUT_MS`                                                | `10000`; positive integer no larger than Node's timer range                                                                                    |
| `LD_ROOM_CAP`, `LD_MAX_ROOMS`, `LD_MAX_SOCKETS`, `LD_SOCKETS_PER_IP` | `8`, `1000`, `4000`, `64`                                                                                                                      |
| `LD_MAX_PAYLOAD`                                                     | 1 MiB + 2 KiB; minimum 1 MiB + 1 KiB + 9 bytes preserves session framing and fragmentation; welcome advertises the envelope bound              |
| `LD_BYTES_PER_WINDOW`, `LD_WINDOW_MS`                                | 64 MiB per 10000 ms, replenished continuously                                                                                                  |
| `LD_FRAMES_PER_SECOND`, `LD_FRAME_BURST`                             | `200`, `1000`; hello counts toward both inbound budgets                                                                                        |
| `LD_SOCKET_BUFFER_BYTES`, `LD_TOTAL_BUFFER_BYTES`                    | 128 MiB per socket, 512 MiB aggregate                                                                                                          |
| `LD_HELLO_TIMEOUT_MS`                                                | `10000`                                                                                                                                        |
| `LD_PING_INTERVAL_MS`, `LD_MISSED_PONGS`, `LD_IDLE_TIMEOUT_MS`       | `25000`, `2`, `300000`; ping/pong does not reset data idleness                                                                                 |

When `LD_TRUST_PROXY=1`, each trusted ingress must **append** its observed upstream address
to `X-Forwarded-For`, rather than pass client values through unchanged. Set `LD_TRUST_PROXY_HOPS`
to the number of trusted proxy hops. For one proxy, `attacker-prefix, real-client` resolves to
`real-client`. Missing or invalid selected addresses are refused; untrusted prefixes cannot
rotate the per-IP admission identity.

## Static hosting and security headers

`static.ts` validates the static root, `index.html` and generated `headers.json` before the
listener opens. Vite emits the manifest from `selfHostHeaderManifest`, the same policy generator
used by nginx and Caddy; the runtime consumes data without importing Vite. For custom framing
or providers, run `pnpm headers:self-host --out dist` with the existing options after building.
This changes header data only; application switches remain compiled into the UI.

Files are served below `LD_BASE`, with query-preserving trailing-slash redirects for the base and
directory indexes, and an index fallback for extensionless SPA routes. App index HTML is prepared
and cached at startup with a base element anchored to `LD_BASE`. Missing resources and directories without an
index return 404. The server never lists directories or exposes `headers.json`. Decoded dot
segments, backslashes, Windows path aliases, malformed escapes and symlink escapes are refused.
Keep the static root read-only in production. `<base>api` and `<base>collab` namespaces stay
reserved (501 for non-upgrade requests).

HTML is `no-cache`, successful assets use nginx's immutable policy, module scripts keep the
shared embed cache/CORS/resource policy, and errors are `no-store`. MIME types include JS,
CSS, SVG, fonts, JSON and WebAssembly. Brotli (explicit quality 4) and gzip use a 32 MiB, 256-entry
LRU keyed by file metadata and encoding, with in-flight deduplication and at most two compression
jobs. Inputs over 8 MiB or requests arriving while both slots are occupied use identity (406 when
identity is forbidden). Quality-value negotiation and `Vary: Accept-Encoding` are preserved; no
precompressed build is required. App/embed CSP selection uses parsed query parameters, matching
the app; the auth page omits the opener policy.

## Health, telemetry and shutdown

`/healthz` returns 200 for liveness. `/readyz` is ready only after validated configuration,
static initialization (when enabled), relay initialization and listening; it fails during drain.
The operational paths are rooted at `/`, independent of `LD_BASE`; disabled `/metrics` is always
404 rather than an SPA fallback. Static-off mode still serves health and the relay.

`LD_METRICS=1` enables Prometheus text: `rooms_active`, `sockets_active`, `bytes_in_total`,
`bytes_out_total`, `refusals_total{reason}`, `buffer_bytes`, `buffer_budget_bytes`,
`socket_buffer_budget_bytes` and current `rooms_by_size{size="N"}` gauges (one series for each size
from 1 through `LD_ROOM_CAP`, including zero counts). Byte counters count
received/queued relay message payload bytes (including control messages), excluding WebSocket
framing and ping/pong. Buffer accounting includes framing and close reservations. Refusal labels
are server-owned categories, never arbitrary input. No metric identifies a room or client.

Logs are JSON lines containing whitelisted event/code fields, plus IPs only with `LD_LOG_IPS=1`.
No request URLs, payloads, room IDs, close reasons or raw errors are logged. Startup failures
emit a fixed event and exit unsuccessfully. Total admission reserves pending upgrades as well
as established sockets and releases both total and per-IP slots after failed handshakes.
HTTP headers/requests also have bounded parsing deadlines.

`drain()` removes readiness and refuses upgrades while sending 1012 to open relay sockets; it
can be used as a readiness-removal grace phase. SIGTERM/SIGINT call idempotent `shutdown()`,
which drains and immediately stops the listener, waits for close handshakes and HTTP responses,
then destroys all remaining TCP/WebSocket connections after `LD_DRAIN_TIMEOUT_MS`. Timers and
relay membership are cleaned up; no persistent storage needs flushing.

## Validation

Root Vitest discovers `services/server/test/`. Tests bind `127.0.0.1:0`, use real `ws`
connections and fake clocks for deadlines. Ordered ping/pong barriers replace timed sleeps.
`src/collab/transport/relay.test.ts` runs the existing transport conformance suite, including
three real Yjs sessions, rejoin and canary/secret capture checks at the server. The server sees
only the exact hello room ID and opaque binary frames. Root typechecking includes the server
package and its tests. Existing production bundle tests guard the unchanged startup chunks
and exclude all collaboration code from the public build. No parity golden changes are intended.

Docker parity and Linux gate runs mount each `services/*` package's `node_modules` into
Linux-only named volumes with copying disabled. This keeps pnpm's workspace links separate
from the host installation, including when the source uses a bind mount.
