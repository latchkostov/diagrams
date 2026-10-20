# Self-hosting Live Diagrams

Live Diagrams runs in the browser: HTML, JavaScript, CSS, bundled fonts and icons. The default deployment is a
static site. An optional [collaboration server](#collaboration-server) adds an encrypted WebSocket relay, with
no database, account service or telemetry. You provide HTTPS and, if needed, your own sign-in gate.

## Choose a target

| Target                                                                      | Choose it when                                   | Security headers / framing                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| [Docker / Compose](#docker-and-compose)                                     | You want a ready-to-serve container              | Generated nginx policy; query-specific embed allowlist           |
| [Kubernetes / Helm](#kubernetes-and-helm)                                   | You already run a cluster                        | Same container, probes, replicas and optional TLS ingress        |
| [nginx / Caddy](#nginx-and-caddy)                                           | You already have a web server or SSO proxy       | Full headers; query-specific embed allowlist                     |
| [Netlify / Vercel / Cloudflare Pages](#netlify-vercel-and-cloudflare-pages) | You want managed static hosting                  | Full headers; Netlify/Pages use one framing policy for all pages |
| [Azure Static Web Apps](#azure-static-web-apps)                             | Your organisation uses Azure / Entra             | Full headers; one framing policy; optional platform auth         |
| [S3 + CloudFront](#s3-and-cloudfront)                                       | You want a private bucket and CDN                | Generated response policies per cache behaviour                  |
| [GitHub Pages](#github-pages)                                               | A public, low-maintenance copy is sufficient     | No custom HTTP headers; meta-CSP cannot restrict framing         |
| [Offline bundle](#air-gapped-and-offline-networks)                          | Build outside a closed network and copy files in | Site, policies, docs and checksums in one archive                |

Templates and short target READMEs are in [deploy/self-host/](../deploy/self-host/). They contain no credentials.
All policies derive from `scripts/security-headers.ts`; regenerate them instead of copying CSP strings by hand.

## Build and lock it down

Use the Node.js version in `.nvmrc` and pnpm version in `packageManager`. Pin a release commit or tag:

```sh
git clone https://github.com/latchkostov/diagrams.git live-diagrams
cd live-diagrams
git checkout <release-commit-or-tag>
corepack enable
pnpm install --frozen-lockfile
VITE_BRAND_NAME="Acme Diagrams (internal)" pnpm build:internal
```

Deploy the contents of `dist/`. Its paths are relative, so the same build works at `/` or a directory such as
`/tools/diagrams/`. Use a trailing slash at that address. PowerShell: set
`$env:VITE_BRAND_NAME = "Acme Diagrams (internal)"` first, then run `pnpm build:internal`.

For a server with SPA fallback at arbitrary deep paths, run `pnpm self-host:prepare --base /tools/diagrams/`
after building (use `--base /` for root hosting). This adds a base tag to built index.html so its relative assets
resolve to your directory. It does not edit application source; Docker and offline packaging do this automatically.

These switches retain their existing behaviour. They are compiled into JavaScript; changing a container's
runtime environment or a Helm value cannot change them. Rebuild the site/image after changing a switch.

| Build variable             | Normal build  | Internal build | Effect when set to `1`                                                                                                                 |
| -------------------------- | ------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_DISABLE_SHARE_LINKS` | off           | **1**          | Removes share links, password links and URL embeds. File exports and host-supplied private embeds stay available.                      |
| `VITE_DISABLE_LINK_OPEN`   | off           | off            | Stops opening `#d=` / `#e=` links, including in embeds. Host-supplied embeds still work.                                               |
| `VITE_DISABLE_AI_TOOLS`    | off           | **1**          | Removes browser-agent tools, Copy for AI, copied prompts and Build with AI.                                                            |
| `VITE_DISABLE_ONDEVICE`    | off           | off            | Removes Chrome's on-device model and its microphone; with AI tools off, removes the AI panel.                                          |
| `VITE_PRIVATE_BY_DEFAULT`  | off           | **1**          | Starts new diagrams Private; people can still change that setting.                                                                     |
| `VITE_BRAND_NAME`          | Live Diagrams | Live Diagrams  | Your name in the top bar and page title (up to 60 characters).                                                                         |
| `VITE_LOCALES`             | all           | all            | Comma-separated languages, default first, e.g. `de,en`. One language removes the language choice.                                      |
| `VITE_ENABLE_COLLAB`       | off           | off            | Alias for `VITE_COLLAB=public` when `VITE_COLLAB` is unset. Rooms are independent of share links. See [Edit together](#edit-together). |

A boolean is on with `1`, `true`, `yes` or `on`. Shell variables override Vite's `.env` files; internal defaults
apply only to unset variables. Set `0` explicitly to override an internal default. The container treats empty
optional build arguments as unset. `build:internal` prints the resolved settings.

For a closed network, also disable link opening and the on-device model:

```sh
VITE_DISABLE_LINK_OPEN=1 VITE_DISABLE_ONDEVICE=1 VITE_LOCALES=en pnpm build:internal
```

Cloud storage is off unless you set `VITE_GOOGLE_*`, `VITE_ONEDRIVE_*` or `VITE_DROPBOX_*` variables. Leave them
unset for an offline deployment. If you intentionally configure a provider, generate headers with `--providers`
and follow [INTEROP.md](INTEROP.md#storage-providers) for its registration and redirect URLs. Never put client
secrets in `VITE_*`: those values are public build inputs. Container builds exclude `.env` files; the supplied
image recipe supports the switches above, rather than provider credentials.

The default internal build still offers Chrome's on-device model. Chrome downloads that model once; dictation
may use its online speech service. CSP limits page requests, not browser services or extensions. Disable
on-device features and manage browser policy where zero external traffic is required.

## Edit together

Edit together lets people edit one diagram at the same time, each in their own browser
([EDIT-TOGETHER.md](EDIT-TOGETHER.md)). It is **off** in every self-hosted build unless you set
`VITE_COLLAB=public` or `VITE_COLLAB=server`. `VITE_ENABLE_COLLAB=1` is the legacy alias for `public`.
Rooms are independent of `VITE_DISABLE_SHARE_LINKS`; Private diagrams remain blocked in every mode.
Without collaboration enabled, the build carries no room code at all. For a static build using public discovery,
set `VITE_COLLAB=public` in your build environment (or in a local `.env.local` file), then run:

```sh
pnpm build:internal
```

**What a room contacts.** Browsers in a room connect to each other directly (WebRTC), with the diagram end-to-end
encrypted. To find each other they use matchmaking trackers and a STUN server. Unless you name your own, those are:

- the public WebTorrent trackers `wss://tracker.openwebtorrent.com` and `wss://tracker.webtorrent.dev`, run by
  volunteers;
- Cloudflare's STUN server `stun:stun.cloudflare.com:3478`.

There is no TURN server by default. Each of these services sees the IP addresses of the people in a room, and the
people in a room see each other's. The join and start dialogs say so, and name the services this build uses. Nothing
is sent to livediagrams.dev. Private diagrams can't be in a room.

**Your own endpoints**, set at build time. They are compiled into the site, like every switch:

| Build variable                | Default                         | Value                                                                                   |
| ----------------------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| `VITE_COLLAB_TRACKERS`        | the two public trackers         | WebTorrent tracker URLs: `wss://` (plain `ws://` only for `localhost`), comma-separated |
| `VITE_COLLAB_STUN`            | `stun:stun.cloudflare.com:3478` | `stun:` or `stuns:` URLs, comma-separated, or `none` for no STUN server                 |
| `VITE_COLLAB_TURN`            | none                            | `turn:` or `turns:` URLs (`?transport=udp` or `tcp` allowed), comma-separated           |
| `VITE_COLLAB_TURN_USERNAME`   | none                            | The TURN username. Required with `VITE_COLLAB_TURN`                                     |
| `VITE_COLLAB_TURN_CREDENTIAL` | none                            | The TURN credential. Required with `VITE_COLLAB_TURN`                                   |

A malformed value stops the build rather than shipping a copy that can't connect. Tracker URLs are normalised
(`WSS://T.example.com` becomes `wss://t.example.com/`).

> **TURN credentials are visible to anyone who can open the page.** Like every `VITE_*` value, they are compiled
> into the JavaScript the browser downloads. Use a TURN account that can only relay (no admin rights), limit it to
> your users' networks if your TURN server allows, rotate it by rebuilding, and keep the site behind your sign-in.
> The values are compiled into the room's own code only, which the app loads when someone starts or joins a room.

**On locked-down or corporate networks** (full-tunnel VPNs, strict firewalls, some mobile hotspots), browsers may
not be able to connect directly. Peers then need a TURN server to relay their encrypted traffic. You can run your own,
coturn for example, and name it with `VITE_COLLAB_TURN`. Set `VITE_COLLAB_STUN=none` (or name your own STUN server)
so the browser doesn't ask a public one for its address.

**Your own tracker.** Any WebTorrent-compatible WebSocket tracker works, for example
[bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker) with WebSocket support. Serve it over `wss://`
on a host your users' browsers can reach, and set `VITE_COLLAB_TRACKERS=wss://tracker.example.com`. With your own
trackers, STUN set to `none` (or your own) and your own TURN server if needed, rooms no longer depend on public
matchmaking or public ICE services.

> **These settings don't confine where peers connect.** The browsers in a room still try every address the others
> advertise. A member whose browser advertises an outside address (at home, on a VPN, or on purpose) can make the
> others run connectivity checks to it, and possibly connect directly, outside your network. Setting TURN doesn't
> force relay-only connections either: it adds a relay, and direct paths are still tried. To keep peer traffic
> inside your network, use network egress controls (firewall rules for the browsers' UDP and TCP traffic), and keep
> the site behind your sign-in so only your people can open a room link.

**Headers.** `pnpm headers:self-host`, the build's `headers.json` and the Docker image follow the same variables. With
the switch on, the app's `connect-src` allows the trackers' origins (never an embed's, on hosts that can tell them
apart). STUN and TURN aren't page requests, so CSP can't govern them. The compiled list names the only STUN and TURN
servers the app uses, but it doesn't limit which peer addresses a browser tries (see above).

For private networks without public discovery, use the [collaboration server](#collaboration-server).

## Collaboration server

One image serves the UI and a thin encrypted WebSocket relay. Browsers encrypt diagrams and presence before
sending them; the relay never sees diagram content, room secrets, links or room keys. Use it for private
networks where rooms must stay on your infrastructure: server mode contacts no third-party trackers, STUN or
TURN services, and uses no WebRTC. There is no fallback to public infrastructure.

The operator can see client IP addresses, timing, opaque room IDs, membership counts and frame sizes/counts.
Envelope headers expose channel, random sender ID and counter. Encryption protects against relay inspection,
logs and memory dumps; it cannot protect against a malicious operator who also serves modified JavaScript
that steals keys. See the [threat model](research/collaboration-threat-model.md#what-each-party-sees).

### Build modes

These are build-time settings, never runtime configuration. Set them in your build environment or a local
`.env.local` file before `pnpm build:internal`; the command is the same on every OS. Rebuild after changes.

| Variable             | Default | Meaning                                                                                                                                                                                                                           |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_COLLAB`        | `off`   | `off`: no rooms; `public`: WebRTC with configured/public discovery; `server`: encrypted WebSocket relay only.                                                                                                                     |
| `VITE_COLLAB_SERVER` | unset   | In server mode, defaults to `collab/v1` relative to `document.baseURI`, including the site's directory prefix. For another origin, set an absolute `wss://` URL including the relay path, without credentials, query or fragment. |
| `VITE_ENABLE_COLLAB` | off     | `1` aliases `public` if `VITE_COLLAB` is unset. An explicit `VITE_COLLAB` takes precedence.                                                                                                                                       |

The static image stays collaboration-off by default. The server image compiles `VITE_COLLAB=server` with a
same-origin relay. Rooms work even with share links disabled. **Private diagrams cannot start or join rooms
in any mode, including on your own server. There is no escape hatch.** This remains blocked pending an
independent crypto review. The internal profile still starts new diagrams Private.

### Deployment and access

From a pinned checkout with Docker available:

```sh
docker compose -f deploy/self-host/server/compose.yaml up --build -d
docker compose -f deploy/self-host/server/compose.yaml logs
docker compose -f deploy/self-host/server/compose.yaml down
```

Open `http://localhost:8080/` for a local check. For deployment, use HTTPS: the server speaks HTTP on 8080
and TLS terminates at Caddy, nginx or your ingress. The distroless image runs as a non-root user with a
read-only root, all capabilities dropped and no writable paths. CI builds and smoke-tests the image; no
project image is published to GHCR. Build your own:

```sh
docker build -f services/server/Dockerfile -t live-diagrams-server:local .
```

Set deployment runtime variables in a local Compose `.env` file or your orchestrator, for example
`LD_ORIGIN=https://diagrams.example.com`. Compose forwards `LD_BASE`, `LD_STATIC`, `LD_ORIGIN`,
`LD_TRUST_PROXY` and `LD_TRUST_PROXY_HOPS`; add other settings to its `environment` mapping as needed.
The Compose build accepts brand, locales, on-device and framing build arguments as shown in its file.

Use the [Caddy and nginx server variants](#collaboration-proxy-layouts) to proxy the full site and WebSockets,
preserving the directory prefix. For a separate static host, compile that UI with `VITE_COLLAB=server`, set
`LD_STATIC=off` on the relay, and proxy `<base>collab/` with the relay-only templates. Static routes then
return 404 on the relay; health endpoints remain available. [Helm server mode](../deploy/self-host/helm/README.md#collaboration-server)
uses the same image, pins one replica and uses `Recreate`, because rooms live in one process.

**There is no built-in access control beyond the Origin check and limits.** Origin is not authentication:
non-browser clients can supply it. Put both the UI and WebSocket upgrade behind your SSO proxy or VPN.
Same-origin WebSocket upgrades carry the proxy's session cookie. Protect the relay listener from direct
client access if you trust forwarding headers. The chart installs no sign-in service or network policy.

### Server settings

All runtime settings read by the server are below. Flags accept only `0` or `1`; numeric settings are integer
bytes, counts or milliseconds as named. Invalid values stop startup. Origins include scheme and optional
port, without a path or trailing slash; `LD_ALLOWED_ORIGINS` is a comma-separated list of exact origins.

| Variable                 | Default                                              | Purpose                                                                                       |
| ------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `LD_HOST`                | `0.0.0.0`                                            | HTTP bind address.                                                                            |
| `LD_PORT`                | `8080`                                               | HTTP port (0–65535; 0 chooses an ephemeral port).                                             |
| `LD_BASE`                | `/`                                                  | Site/relay directory prefix, with leading and trailing slashes, e.g. `/tools/diagrams/`.      |
| `LD_ORIGIN`              | unset: `http://<Host>`                               | Expected browser Origin. Set the public HTTPS origin behind a TLS proxy.                      |
| `LD_ALLOWED_ORIGINS`     | empty                                                | Additional allowed browser origins, for a separately hosted UI. No wildcard.                  |
| `LD_TRUST_PROXY`         | `0`                                                  | Use the trusted forwarding chain for per-IP quotas; otherwise use the socket address.         |
| `LD_TRUST_PROXY_HOPS`    | `1`                                                  | Select the Nth address from the right of `X-Forwarded-For` when proxy trust is enabled.       |
| `LD_LOG_IPS`             | `0`                                                  | Opt in to client IPs in JSON logs.                                                            |
| `LD_METRICS`             | `0`                                                  | Enable Prometheus `/metrics`; restrict it at the proxy. No per-room labels.                   |
| `LD_STATIC`              | `on`                                                 | `off` serves only the relay and operational endpoints.                                        |
| `LD_STATIC_DIR`          | source-relative `../../../dist/`; image: `/app/site` | Static files and generated `headers.json`.                                                    |
| `LD_DRAIN_TIMEOUT_MS`    | `10000`                                              | Maximum graceful shutdown drain before sockets are terminated.                                |
| `LD_ROOM_CAP`            | `8`                                                  | Sockets per room, configurable from 1 to 64.                                                  |
| `LD_MAX_PAYLOAD`         | `1050624` (1 MiB + 2 KiB)                            | WebSocket payload ceiling; allowed range 1049609–1050624 preserves the client frame contract. |
| `LD_BYTES_PER_WINDOW`    | `67108864` (64 MiB)                                  | Inbound bytes per socket per window.                                                          |
| `LD_WINDOW_MS`           | `10000`                                              | Inbound byte-budget window.                                                                   |
| `LD_FRAMES_PER_SECOND`   | `200`                                                | Per-socket inbound frame refill rate.                                                         |
| `LD_FRAME_BURST`         | `1000`                                               | Per-socket inbound frame burst capacity.                                                      |
| `LD_SOCKET_BUFFER_BYTES` | `134217728` (128 MiB)                                | Close a socket exceeding its outbound buffer limit (minimum 127).                             |
| `LD_TOTAL_BUFFER_BYTES`  | `536870912` (512 MiB)                                | Server-wide outbound buffer budget; refuse new joins when exhausted (minimum 127).            |
| `LD_MAX_ROOMS`           | `1000`                                               | Maximum active rooms. Empty rooms are deleted immediately.                                    |
| `LD_MAX_SOCKETS`         | `4000`                                               | Maximum total sockets.                                                                        |
| `LD_SOCKETS_PER_IP`      | `64`                                                 | Maximum sockets per observed client IP; shared NAT addresses share a quota.                   |
| `LD_HELLO_TIMEOUT_MS`    | `10000`                                              | Deadline for the initial room hello.                                                          |
| `LD_PING_INTERVAL_MS`    | `25000`                                              | WebSocket ping interval.                                                                      |
| `LD_MISSED_PONGS`        | `2`                                                  | Missed pong threshold before disconnection.                                                   |
| `LD_IDLE_TIMEOUT_MS`     | `300000`                                             | Close after five minutes without data; normal presence prevents idle expiry.                  |

Trust proxies only with an isolated listener and a fixed trusted chain. nginx appends its observed client IP;
counting from the right prevents a spoofed caller prefix from bypassing quotas. Caddy discards untrusted
incoming forwarding values by default. See [proxy layouts](#collaboration-proxy-layouts) before setting hops.
Logs contain whitelisted event/code fields, plus IPs only when opted in: no payloads, room IDs or keys. The
container smoke test asserts neither a synthetic diagram canary nor actual room IDs appear in `docker logs`.

### Upgrades, health and limits

There is no server persistence or server backup. Keep one instance: replicas would split rooms. On shutdown,
sockets receive restart code 1012; browsers reconnect with jitter and resync from each other. A restart cannot
restore a room when no browser or local recovery copy retains it. Keep browser-saved/exported copies.

`/healthz` checks liveness and `/readyz` returns 503 while draining. Both paths stay at the origin root even
with `LD_BASE` set. The image's `node main.js --healthcheck` checks readiness without curl or wget. Keep probes
reachable without an SSO redirect. Rebuild at the next pinned commit with the same build inputs, deploy the
image and matching headers together, and verify readiness and reconnection. Helm uses `helm upgrade` or
`helm rollback` with the previous image tag; `Recreate` entails a brief interruption.

| Symptom                           | Check                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server unreachable                | Check `/readyz`, public `LD_ORIGIN`, the exact prefix and `collab/v1` route, TLS, WebSocket upgrade headers, proxy timeouts and SSO session. There is no public fallback. |
| Room full                         | `LD_ROOM_CAP` counts sockets in each room, including extra tabs; close unused tabs or raise the cap within 1–64. Lobby sockets also count toward IP/global quotas.        |
| Cross-origin relay blocked by CSP | Set `VITE_COLLAB_SERVER` when building the UI; regenerate and install its headers with the command below. Add the UI origin to the relay's `LD_ALLOWED_ORIGINS`.          |

```sh
pnpm headers:self-host --collab-server wss://relay.example.com/collab/v1
```

This permits exactly that relay origin in `connect-src`. Keep generated headers consistent with the UI's
build mode; same-origin relays need no outside connection origin.

## Generate your headers

Without cloud storage, generated policies permit no external script, frame or connection origins. The editor
may be framed only by itself; embeds (`?embed`, with any value) may also be framed by your listed origins:

```sh
pnpm headers:self-host --frame-ancestors "https://wiki.example.com https://*.example.com"
pnpm headers:self-host --base /tools/diagrams/ --frame-ancestors "https://wiki.example.com"
pnpm headers:self-host --providers   # only for intentionally configured cloud storage
```

With `VITE_ENABLE_COLLAB=1` in the shell or `.env`, the same command adds the build's trackers to `connect-src`
([Edit together](#edit-together)). Run it with the variables you build with.

Output goes to ignored `self-host-headers/`; `--out <directory>` changes it. It includes nginx, Caddy, Netlify,
Vercel, Pages, Azure, AWS and GitHub Pages policies. HTTPS origins only (localhost HTTP is allowed for testing).
The default allowlist is empty. Checked-in `framed/` files use example domains; replace them.

Netlify, Cloudflare Pages, Azure and CloudFront response policies cannot distinguish the editor from an embed
by query. With an allowlist, their generated policy allows those origins to frame the whole app too. Use nginx,
Caddy or Vercel if the editor must remain same-origin-only. When providers are enabled on a flat host, both
editor and embeds receive the app's provider resource permissions; the viewer still never calls those providers.
Meta-CSP does **not** enforce `frame-ancestors`;
use a host with HTTP security headers for sensitive deployments.

## Confluence Data Center

Install the [user-macro recipe](../deploy/self-host/confluence-dc/README.md) to render an attachment or
inline Diagram file JSON using your self-hosted `<live-diagram>` component. The Confluence page supplies
the data with its own session and permissions; the viewer holds it only in memory. No public diagram URL
is created. The macro always starts still and offers click-to-play, even for files saved to play on open.

Generate and deploy your viewer's HTTP headers with the Confluence **origin**, without its context path:

```sh
pnpm headers:self-host --frame-ancestors "https://wiki.example.com"
# For a viewer served under /tools/diagrams/:
pnpm headers:self-host --base /tools/diagrams/ --frame-ancestors "https://wiki.example.com"
```

Install the generated policy for your chosen host (see above); running the command alone does not change
your server. Keep the embed-script CORS headers for both `embed/live-diagram.js` and the recipe's
`embed/confluence-dc.js`. Query-aware policies allow the wiki to frame `?embed=1&host=1`, while the editor
remains same-origin-only. Query-blind hosts allow the listed origin to frame the whole site. Check that
an upstream proxy does not add a conflicting CSP or `X-Frame-Options: SAMEORIGIN`/`DENY` to embeds.

Serve the viewer shell, its assets and both embed modules outside SSO, while protecting the editor and
Confluence attachments. These are static code, without diagram data. A frame behind cross-site SSO may
fail when third-party cookies are blocked or a login page refuses framing. A same-site viewer such as
`https://diagrams.example.com` beside `https://wiki.example.com` can help with cookie restrictions;
test your actual authentication policy. The robust option is an ungated viewer with gated attachments.

In Confluence's existing CSP, add the viewer origin to **both `script-src` and `frame-src`** (and
`script-src-elem` if explicitly present). For example, extend each applicable source list with
`https://diagrams.example.com`, retaining the existing sources. The recipe uses external module scripts;
it needs neither inline scripts nor `eval`. Attachment fetching uses Confluence's own origin, so keep
`connect-src 'self'`. Keep the viewer's policy separate from the wiki's policy: `frame-ancestors` says
who may embed the viewer; the wiki's `frame-src` says which viewer it may load.

Data Center gets a user macro rather than a Java plugin: it reuses the existing viewer and avoids a
separate plugin release cycle for a product approaching
[Atlassian's announced end of life on March 28, 2029](https://www.atlassian.com/licensing/data-center-end-of-life).
This recipe covers Data Center only; Cloud integration and embed-destination UI are separate work.

## Docker and Compose

```sh
docker build -t live-diagrams:local \
  --build-arg VITE_BRAND_NAME="Acme Diagrams (internal)" \
  --build-arg VITE_DISABLE_ONDEVICE=1 \
  --build-arg FRAME_ANCESTORS="https://wiki.example.com" .
docker run --rm -p 127.0.0.1:8080:8080 live-diagrams:local
```

Open `http://localhost:8080/`. The multi-stage image builds with pnpm and serves with nginx-unprivileged as UID
101 on port 8080. Only built files and generated config enter the final image. It has a `/healthz` healthcheck,
gzip, immutable hashed assets, revalidated HTML and an SPA fallback; missing assets/modules return 404.
Terminate HTTPS at your reverse proxy. gzip works without installing an optional Brotli nginx module.

All switches, brand and locales above are Docker build arguments, and so are Edit together's
(`VITE_ENABLE_COLLAB`, `VITE_COLLAB_*`). `BUILD_PROFILE=internal` is the default;
`BUILD_PROFILE=public` uses `pnpm build` defaults, while retaining the self-host policy. Build with
`BASE_PATH=/tools/diagrams/` to serve only that directory (and `/healthz`). The image redirects the slashless
directory URL. Keep the ingress/proxy path intact; do not strip it for a sub-path image.

Compose reads the same variables from your shell or Compose `.env` (not copied into the image):

```sh
VITE_BRAND_NAME="Acme Diagrams" VITE_LOCALES=en BASE_PATH=/tools/diagrams/ docker compose up --build -d
docker compose logs diagrams
docker compose down
```

Compose binds loopback and uses a read-only filesystem, writable `/tmp` and no Linux capabilities. Put it behind
your HTTPS/SSO proxy. `pnpm self-host:smoke` builds root and sub-path images, starts them on assigned loopback ports,
checks headers, caching, gzip and routing, then removes both containers. CI runs it without publishing images.

## Collaboration proxy layouts

The in-memory collaboration server is built with `services/server/Dockerfile`; its Compose service is
`deploy/self-host/server/compose.yaml`. Use generated `nginx/nginx.server.conf` or `caddy/Caddyfile.server`
to proxy both the site and WebSockets. Set `LD_BASE` to the same directory prefix used when generating
the proxy config (`pnpm headers:self-host --base /tools/diagrams/`). Keep that prefix intact upstream.
Set `LD_ORIGIN` to the public proxy origin, including scheme and optional port, without a path or trailing slash.

For one proxy directly facing clients, set `LD_TRUST_PROXY=1` and `LD_TRUST_PROXY_HOPS=1` on the server.
Compose forwards both variables and defaults to proxy trust disabled for direct access. Enable trust only
when clients cannot reach the server directly: use a private container network or firewall, and expose
only the proxy. Otherwise clients could bypass the proxy's forwarding-header protection.

nginx appends its observed client address with `$proxy_add_x_forwarded_for`. Admission counts from the
right of `X-Forwarded-For`, so a caller's spoofed prefix cannot change the selected IP. With two trusted
proxies that each append their observed peer, set `LD_TRUST_PROXY_HOPS=2`; every path to the server must
have that same trusted chain. Never count caller-supplied entries as trusted hops.
[Caddy supplies forwarding headers by default](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers),
discarding untrusted incoming values. Keep the generated Caddy defaults for a single proxy; deployments
with additional proxies must explicitly configure Caddy's trusted proxy ranges and match the server's
hop count to the resulting chain. Do not override `X-Forwarded-For` with the raw incoming header.

For a separately hosted static site, set `LD_STATIC=off` and use `server/relay-only.nginx.conf` or
`server/relay-only.Caddyfile` at its proxy. The nginx fragment supplies an HTTP-context map and a server-context
location; install each in the indicated context beside the existing static routes. The server keeps
`/healthz` available but returns HTTP 404 for static content. Its healthcheck follows `LD_HOST`, mapping
wildcard IPv4/IPv6 binds to the corresponding loopback address.

`pnpm self-host:smoke --server-only` exercises nginx and Caddy at root and subpaths, in site-and-relay
and relay-only modes, with real bidirectional WebSocket frames, rejected origins and spoofed forwarding headers.

## Kubernetes and Helm

Build an image with your arguments, give it a versioned tag and make it available to your cluster (load it into
a local cluster, or push it to **your** private registry). No image is published by this project.

```sh
kubectl apply -f deploy/self-host/kubernetes/manifest.yaml
# Optional: edit host, ingress class, TLS secret and issuer first:
kubectl apply -f deploy/self-host/kubernetes/ingress.example.yaml
```

Change the Deployment's image first. Examples provide replicas, resource limits, non-root pods, read-only
filesystems, writable `/tmp`, health probes and a Service. The optional Ingress assumes you already installed
an ingress controller; the cert-manager annotation is an example, not an installed TLS service.

```sh
helm lint deploy/self-host/helm
helm upgrade --install diagrams deploy/self-host/helm \
  --set image.repository=registry.example.com/live-diagrams --set image.tag=<release> \
  --set ingress.enabled=true --set ingress.host=diagrams.example.com \
  --set ingress.tls.enabled=true --set ingress.tls.secretName=diagrams-tls
```

Use a values file for replicas, resources, ingress annotations and build metadata. `build.switches`,
`build.profile`, `build.basePath` and `build.frameAncestors` describe the image you built; they are recorded as a
pod annotation, **not** injected as ineffective runtime `VITE_*` variables (the annotation leaves out
`VITE_COLLAB_TURN_CREDENTIAL`). Build a matching image first.
The ingress path follows `build.basePath`; set it to the image's `BASE_PATH`. Do not enable path rewriting.

To build directly from that values file, set its image repository/tag and run:

```sh
pnpm self-host:image my-values.yaml
# Load or push the resulting image into your own cluster, then:
helm upgrade --install diagrams deploy/self-host/helm -f my-values.yaml
```

This passes the chart's switches, profile, path and framing origins to Docker as build arguments. It builds
locally and does not push to a registry. Use a complete values file based on the chart's `values.yaml`.

For the UI plus relay, select `mode: server`, build `services/server/Dockerfile` and set `server.image`.
`pnpm self-host:image` remains the static-image builder. See [Helm server mode](../deploy/self-host/helm/README.md#collaboration-server)
for runtime `server.env`, TLS/proxy trust and timeout settings. Server mode forces one replica and `Recreate`;
its readiness check is `/readyz` and its liveness check is `/healthz`. Static mode is unchanged.

## nginx and Caddy

1. Build the site, prepare its base tag with `pnpm self-host:prepare --base <path>/`, and generate headers with
   the same allowlist and path.
2. nginx: copy files to `/usr/share/nginx/html/` (or `/usr/share/nginx/html/tools/diagrams/` for a sub-path).
   Include `self-host-headers/nginx/nginx.conf` inside `http {}`. It listens on 8080; change listen/TLS and root
   settings for your server, keeping generated maps and headers. Run `nginx -t`, then reload.
3. Caddy: copy bare `dist/` contents to `/srv/live-diagrams/`. Install `self-host-headers/caddy/Caddyfile`.
   It strips a configured directory prefix internally. Replace `:8080` with your domain for automatic HTTPS;
   run `caddy validate --config <file>`, then reload. Compression is zstd/gzip.
4. Add your authentication proxy as below, then verify.

The legacy top-level `nginx.conf` is a header snippet for existing configurations; the complete server template
is in `nginx/`. Never add a location-level nginx `add_header` without repeating security headers there: nginx
otherwise drops inherited ones.

## Netlify, Vercel and Cloudflare Pages

1. Build a pinned checkout using your switches and generate headers. Managed hosts normally deploy at `/`.
2. Netlify: put generated `netlify/netlify.toml` at your deployment repository's root. Its build command is
   `pnpm build:internal`, publishing `dist`. Set switches in the platform build environment. Keep netlify.toml
   at the deployment root for manual CLI deployments too; avoid adding a second `_headers` mechanism.
   The auth route uses explicit `unsafe-none` COOP since Netlify cannot remove inherited headers; other
   templates omit that header. Cloudflare's header-detach syntax is not portable to Netlify.
3. Vercel: for a local static deploy, copy generated `vercel/vercel.json` into `dist/`, then run
   `vercel deploy dist`. No build command is needed in that directory. For a connected repository, set build
   command `pnpm build:internal` and output `dist` in project settings and install the generated self-host config
   in your deployment checkout before starting deployment. The repo's `pnpm build` regenerates the public-site
   root config, so keep a separate generated copy for self-host deployment. Self-host config has no upstream
   branch restriction.
4. Cloudflare Pages: copy `_headers` and `_redirects` from generated `cloudflare/` into `dist/` before deploying.
   For a connected build, append header generation and these copy steps to `pnpm build:internal`. These files
   apply to static assets; Pages Functions need their own response headers. The generated `_redirects` contains
   comments only: [native SPA fallback](https://developers.cloudflare.com/pages/configuration/serving-pages/#single-page-application-spa-rendering)
   preserves existing assets. Keep the root `index.html` and omit a top-level `404.html`; never add a blanket
   proxy to `index.html`, which overrides real assets. Native fallback serves the root document, so a Pages
   directory mount also needs that root document prepared with the deployment prefix; `--base` alone does not
   relocate files or change Pages' fallback target.
5. Enable HTTPS and your platform's access gate, then verify. For directory mounts, put files beneath that
   prefix and regenerate with `--base`; nginx/Caddy are the tested directory deployment options.

For example, a complete static Pages build/deploy preparation:

```sh
pnpm build:internal
pnpm self-host:prepare --base /
pnpm headers:self-host --frame-ancestors "https://wiki.example.com"
cp self-host-headers/cloudflare/_headers self-host-headers/cloudflare/_redirects dist/
# Deploy dist/ using your Pages project, then:
pnpm self-host:verify https://diagrams.example.com/ --flat --frame-ancestors "https://wiki.example.com"
```

For Vercel repository deployment, prepare your own deployment checkout before invoking the CLI:

```sh
pnpm build:internal
pnpm self-host:prepare --base /
pnpm headers:self-host --frame-ancestors "https://wiki.example.com"
cp self-host-headers/vercel/vercel.json vercel.json
# Set the Vercel project's build command to pnpm build:internal and output directory to dist.
vercel deploy
```

The CLI reads self-host configuration before starting the remote build. Reinstall that config before every
deployment; for automation, include generation/copy in your deployment preparation step. The file-only
`vercel deploy dist` option avoids repository build/config regeneration entirely.

## Azure Static Web Apps

1. Configure an app with no API, build `pnpm build:internal`, output `dist` and your build environment variables.
2. Copy generated `azure/staticwebapp.config.json` into `dist/` **after** building.
3. If sign-in is required, add `allowedRoles: ["authenticated"]` to protected routes and a catch-all last.
   Azure evaluates routes in order: early matching asset/embed/auth header routes also need `allowedRoles`
   when they require auth. Exempt viewer code only if your access design intentionally makes it reachable.
4. For tenant-specific Entra login, configure a custom provider and 401 login redirect. Use issuer
   `https://login.microsoftonline.com/<TENANT_ID>/v2.0`; `clientIdSettingName` and `clientSecretSettingName` name
   platform app settings. Keep the secret there, never in config or Vite variables. Custom auth needs the
   appropriate Azure plan. Register `https://<host>/.auth/login/aad/callback` and use enterprise-app assignment
   to restrict membership.
5. Deploy and verify. The supplied template configures headers/routing, not your identity provider.

[Azure configuration reference](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration) covers
route precedence, header overrides and authentication settings.

## S3 and CloudFront

1. Upload `dist/` to a private bucket. Use CloudFront Origin Access Control, HTTPS and default root object
   `index.html`; keep public access blocked. Set S3 HTML metadata to `Cache-Control: no-cache`, hashed assets
   to `public, max-age=31536000, immutable`, and unversioned embed code to the generated hour-long policy.
2. Create the generated response policies:

   ```sh
   aws cloudfront create-response-headers-policy --response-headers-policy-config file://self-host-headers/aws/response-headers-policy.json
   aws cloudfront create-response-headers-policy --response-headers-policy-config file://self-host-headers/aws/embed-response-headers-policy.json
   aws cloudfront create-response-headers-policy --response-headers-policy-config file://self-host-headers/aws/auth-response-headers-policy.json
   aws cloudfront create-response-headers-policy --response-headers-policy-config file://self-host-headers/aws/assets-response-headers-policy.json
   ```

3. Attach the app policy to default behaviour, the embed-script policy to `embed/*.js`, and auth policy to
   `auth.html`, and the assets policy to `assets/*`. Use an immutable asset cache policy and matching S3 metadata.
   Set default HTML minimum TTL to zero and enable compression.
   Set embed behaviour TTL to match its generated header. Response headers alone do not set CDN cache TTLs.
4. For arbitrary SPA paths, use a viewer-request rewrite to `index.html` only for non-file app routes. Do not
   globally map all 403/404 to HTML: missing modules must remain errors. Normal app views use query parameters.
5. Add your organisation's authentication at viewer request, e.g. OIDC through Lambda@Edge. CloudFront Functions
   cannot perform an OAuth token exchange. Verify with `--flat` and your framing allowlist.

See [CloudFront response policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/creating-response-headers-policies.html).
They set headers, not access control, cache keys or TLS. For sub-paths, prefix S3 keys and behaviour patterns
consistently; `--base` does not create a distribution.

## GitHub Pages

1. Build an internal copy, create `dist/.nojekyll`, and insert generated `github-pages/meta-csp.html` at the
   **start** of `dist/index.html`'s `<head>`, before scripts/resource links.
2. Deploy `dist/` using Pages upload/deploy actions or a Pages branch. For project Pages, use the trailing-slash
   repository directory URL; asset paths are relative.
3. Pages cannot set custom CSP, Permissions-Policy, COOP, CORP or Referrer-Policy HTTP headers. Meta-CSP covers
   resource loading only for the HTML into which it was inserted, ignores `frame-ancestors` and does not protect
   other static pages. Cross-origin embeds depend on platform CORS. The verifier reports these limitations;
   **a Pages-only deployment cannot pass security verification**.
4. For enforced headers or an access gate, put a configured Cloudflare proxy/Worker in front (set generated
   headers there), or choose another host. Pages alone is not the recommended private host.

## Air-gapped and offline networks

Run on a connected build machine (dependencies must already be cached to build without internet):

```sh
pnpm package:offline --frame-ancestors "https://wiki.example.com"
# Optional: --base /tools/diagrams/ --out /path/to/artifacts
```

It builds a locked internal copy (links, outside AI and on-device features off, new diagrams Private), preserves
brand/language settings, and rejects configured cloud-storage variables, including `.env` files. Output is
`offline-output/live-diagrams-<package-version>-<commit>.tar.gz`, with an adjacent `.sha256`. Inside: `site/`,
generated `headers/`, public deployment docs, LICENSE, VERSION and per-file SHA256SUMS. No runtime Node.js or
package manager is needed. Serve over internal HTTPS; opening the editor from `file://` does not support modules.

```sh
sha256sum -c live-diagrams-<version>-<commit>.tar.gz.sha256
tar -xzf live-diagrams-<version>-<commit>.tar.gz
cd live-diagrams-<version>-<commit>
sha256sum -c SHA256SUMS
```

Copy `site/` to your web root and install the corresponding header config. Assets are bundled; `connect-src`,
`script-src`, `frame-src` permit only the serving origin. Existing self-host e2e checks enforce no requests outside
that origin. Browser-service traffic still requires browser/network policy; CSP cannot govern it. Checksums
check corruption, not authenticity: use a trusted transfer channel and build a pinned, reviewed commit. Archives
made from a dirty checkout have a `-dirty` suffix; they are not release artifacts and should not be distributed.

## Behind SSO or a reverse proxy

Keep HTTPS, path prefix, query strings and generated headers intact. Authenticate the editor and viewer iframe
at your existing proxy. Never put OAuth secrets in templates. For nginx with oauth2-proxy, add `/oauth2/` proxy
routes and an internal `/oauth2/auth` endpoint, then `auth_request /oauth2/auth` on protected site locations and
a 401 sign-in redirect. Forward Host, scheme and original request URI correctly. Keep `/healthz` available to
probes. Store identity-provider secrets in your proxy's secret store.

Private embeds use [EMBEDDING.md](EMBEDDING.md)'s host-supplied protocol: your page fetches its diagram with its
own authentication/cookies and hands it to the viewer in memory. The diagram is never in the iframe URL, never
saved by the viewer and never fetched by the static site. Load `<your-site-directory>/embed/live-diagram.js`;
the component discovers the viewer directory relative to its own script URL, including a sub-path.

Keep `/embed/` reachable. Cross-origin module requests do not carry the viewer's login cookie by default and
cannot execute a sign-in redirect as JavaScript. You may exempt `/embed/*.js` from SSO: it is viewer code, never
diagram data. Generated CORS/CORP lets other origins load it. The iframe itself still needs its normal site
files and, if gated, a valid session. Do not redirect asset requests to login HTML.

As EMBEDDING.md describes, `src-json` is fetched by the **host page** with same-origin credentials by default;
use `credentials="include"` only for a cross-origin API that permits credentials and the exact host origin.
Cross-site iframe sessions may fail under third-party-cookie restrictions even with `SameSite=None; Secure`.
Prefer the wiki and viewer on the same schemeful site (e.g. `wiki.example.com` and `diagrams.example.com`), or
one site/path. `frame-ancestors` allows framing; it does not grant access or fix cookies. Add your viewer origin
to the host page's `script-src` and `frame-src` as EMBEDDING.md describes.

## Verify the deployed instance

From a checkout with dependencies installed:

```sh
pnpm self-host:verify https://diagrams.example.com/ --frame-ancestors "https://wiki.example.com"
pnpm self-host:verify https://diagrams.example.com/tools/diagrams/ --frame-ancestors "https://wiki.example.com"
# Netlify, Cloudflare Pages, Azure or CloudFront with one policy for all pages:
pnpm self-host:verify https://diagrams.example.com/ --flat --frame-ancestors "https://wiki.example.com"
```

Use `--providers` only if your headers retained provider origins. Checks cover HTTP 200, content types, CSP
(including embed frame-ancestors), module CORS/CORP/cache, Referrer-Policy, Permissions-Policy, nosniff and COOP;
auth.html must omit COOP (or explicitly use `unsafe-none`) so OAuth popups can return. The script exits nonzero on problems and does not follow
SSO redirects. For an authenticated check, set `SELF_HOST_VERIFY_COOKIE` locally to a test session cookie, run
it, then unset it; the value is never printed. It verifies serving configuration, not your identity provider.

Also check the browser console and Network panel during editing, exports, simulation and an embed: no CSP
violations or unexpected origins. Headers alone cannot prove every browser interaction works.

## Upgrading

1. Read [RELEASE-NOTES.md](RELEASE-NOTES.md), pin the next release, and install with the lockfile.
2. Rebuild with the same switches, brand, locales, path and allowlist; use a new image tag.
3. Regenerate policies and compare. Deploy site/headers together, verify, and keep the previous release for
   rollback. Retain old hashed assets briefly for tabs still running the old build.
4. Revalidate HTML; never make `index.html` immutable. Helm: `helm upgrade`, or roll back to previous values/tag.

Browser-saved diagrams persist at the same origin (scheme, host and port). Older `diagrams/v1` files open in
newer releases. Before changing origin, ask people to export and reopen their diagrams; browser storage does
not move with the site. A directory prefix does not isolate localStorage: copies at one origin share it.

## Troubleshooting

| Symptom                                  | Check                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Blank page / module served as HTML       | Preserve trailing slash and prefix; missing modules must be 404, not SPA/login HTML.                                  |
| CSP violation / missing headers          | Regenerate; remove duplicate proxy policies and run the verifier.                                                     |
| Embed refuses framing                    | Use the exact host-origin allowlist; remove conflicting X-Frame-Options or a stricter second CSP.                     |
| Embed fails CORS                         | Keep `/embed/*.js` reachable with ACAO/CORP; do not redirect modules to SSO.                                          |
| Iframe repeatedly asks for login         | Check schemeful site, third-party-cookie policy and session cookies.                                                  |
| OAuth popup loses opener                 | Omit COOP on auth.html; register the correct host/path redirect URI.                                                  |
| Switch / language did not change         | Rebuild; runtime env and Helm metadata cannot change compiled settings.                                               |
| Old app after upgrading                  | Revalidate HTML; check CDN minimum TTL and retain old assets during rollout.                                          |
| Empty Your diagrams after moving         | Export from the old origin, then import at the new one.                                                               |
| Docker fails to start                    | Check Linux daemon, port conflicts, logs, `nginx -t` and writable `/tmp` in read-only mode.                           |
| Encrypted export / recording unavailable | Use HTTPS; WebCrypto and capture APIs are restricted on plain HTTP intranets.                                         |
| No Edit together in Share…               | Build with `VITE_COLLAB=public` or `server`; the diagram must not be Private.                                         |
| Room says it can't connect               | Public mode: check tracker reachability/CSP and TURN. Server mode: see [Collaboration server](#collaboration-server). |

## Data and privacy

Diagrams live in browser local storage for your origin, on each person's device. Storage is unencrypted; there
is no server backup. Export diagram files for backup. PNG, SVG, draw.io, Mermaid and Interactive HTML exports
are generated in the browser and downloaded. Interactive HTML is self-contained and can be password-encrypted;
private embeds keep diagrams in memory only.

There are no requests to livediagrams.dev, analytics or CDN fonts/icons in a self-hosted, provider-free build.
In public collaboration mode, a room contacts its trackers and STUN/TURN servers (the public ones unless you name
your own), and the people in it connect to each other directly. Server mode contacts only your relay. While
someone is in a room, an encrypted copy of it is
kept in that browser's IndexedDB so a reload loses nothing. **Clear everything on this device** removes it.
Configured cloud storage sends data to a provider only when used. AI/clipboard exports and browser services
remain subject to enabled features and organisational policies. Static hosts and SSO proxies may log web
requests but receive no diagram content from browser-local editing. Review browser extensions separately.
Replace built public-site privacy/terms pages with your policies if needed; unused `skill/`,
`livediagrams-skill.zip` and `llms.txt` can be removed.
