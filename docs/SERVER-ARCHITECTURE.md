# Collaboration relay core (S1)

`services/server` is an optional Node 24 workspace package. Its only runtime dependency is `ws`.
It forwards existing encrypted collaboration envelopes; it imports neither Yjs nor crypto. There
is no document storage, authentication provider, UI hosting, Docker image or production client
switch in S1. The public application's import graph does not reach the relay transport. Dev and
e2e harnesses can import `createRelayTransport` directly; build-mode selection waits for S3.

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
Close codes are 4000 (protocol/hello timeout), 4003 (Origin), 4008 (room/room-count cap),
4029 (rate/admission/backpressure), 1009 (size), and 1012 (restart).

## Running and configuration

Run `pnpm --filter @livediagrams/server build`, then
`pnpm --filter @livediagrams/server start`. esbuild emits one ESM file with `ws` external.
The default listener is HTTP on `0.0.0.0:8080`; TLS belongs at the reverse proxy. Run behind
your SSO or VPN. Origin checks and resource limits do not replace access control.

All configuration is read once and validated before listening:

| Environment variable                                                 | Default / meaning                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `LD_HOST`, `LD_PORT`, `LD_BASE`                                      | `0.0.0.0`, `8080`, `/`; base starts and ends with `/`; port 0 supports tests                     |
| `LD_ORIGIN`                                                          | Public HTTP(S) origin behind TLS termination; otherwise request HTTP origin                      |
| `LD_ALLOWED_ORIGINS`                                                 | Additional exact HTTP(S) origins, comma-separated; missing/null Origin is refused                |
| `LD_TRUST_PROXY`                                                     | `0`; only `1` trusts the first `X-Forwarded-For` IP; restrict direct access to the trusted proxy |
| `LD_LOG_IPS`, `LD_METRICS`                                           | `0`; boolean settings accept only `0` or `1`                                                     |
| `LD_ROOM_CAP`, `LD_MAX_ROOMS`, `LD_MAX_SOCKETS`, `LD_SOCKETS_PER_IP` | `8`, `1000`, `4000`, `64`                                                                        |
| `LD_MAX_PAYLOAD`                                                     | 1 MiB + 2 KiB; cannot exceed the shared ceiling; advertised envelope bound accounts for framing  |
| `LD_BYTES_PER_WINDOW`, `LD_WINDOW_MS`                                | 64 MiB per 10000 ms, replenished continuously                                                    |
| `LD_FRAMES_PER_SECOND`, `LD_FRAME_BURST`                             | `200`, `1000`; hello counts toward both inbound budgets                                          |
| `LD_SOCKET_BUFFER_BYTES`, `LD_TOTAL_BUFFER_BYTES`                    | 128 MiB per socket, 512 MiB aggregate                                                            |
| `LD_HELLO_TIMEOUT_MS`                                                | `10000`                                                                                          |
| `LD_PING_INTERVAL_MS`, `LD_MISSED_PONGS`, `LD_IDLE_TIMEOUT_MS`       | `25000`, `2`, `300000`; ping/pong does not reset data idleness                                   |

`/healthz` returns 200, `/readyz` returns 503 during drain, and `/metrics` is disabled by
default. S1 metrics report aggregate rooms, sockets, bytes and refusals. `<base>api/` and
non-upgrade `<base>collab/` paths are reserved (501); other paths return 404. S2 adds static
hosting, richer operational metrics/log correlation and bounded graceful drain. S1 logs only
whitelisted event/code fields (and IPs when opted in), never payloads, room IDs or close reasons.

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
