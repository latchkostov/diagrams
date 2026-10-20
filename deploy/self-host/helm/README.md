# Helm

Build a matching image first. Edit a copy of `values.yaml`, then:

```sh
helm lint deploy/self-host/helm
helm template diagrams deploy/self-host/helm -f my-values.yaml
pnpm self-host:image my-values.yaml
# Make the resulting image available to your cluster before installing:
helm upgrade --install diagrams deploy/self-host/helm -f my-values.yaml
```

Set image repository/tag, replicas, resources and ingress host/class/TLS/annotations. `build` records image
build settings as a pod annotation: it does not rebuild the image or inject runtime switches. Use Docker
`--build-arg` for the corresponding switches, brand, locales, path and framing origins. `build.basePath` also
sets the ingress path; keep it identical to image `BASE_PATH`. No controller, certificate issuer or SSO is
installed by the chart. Edit together's switches (`VITE_ENABLE_COLLAB`, `VITE_COLLAB_*`) are build settings too; the
annotation leaves out `VITE_COLLAB_TURN_CREDENTIAL`, which is compiled into the page anyway. See [the guide](../../../docs/SELF-HOSTING.md#kubernetes-and-helm).

## Collaboration server

`mode: static` is the default and keeps the existing site-only deployment. For the UI plus encrypted relay,
build the server image and make it available to your cluster (no image is published by the project):

```sh
docker build -f services/server/Dockerfile -t registry.example.com/live-diagrams-server:release .
helm lint deploy/self-host/helm --set mode=server
helm template diagrams deploy/self-host/helm -f my-values.yaml --set mode=server
helm upgrade --install diagrams deploy/self-host/helm -f my-values.yaml --set mode=server --set server.image.repository=registry.example.com/live-diagrams-server --set server.image.tag=release
```

`pnpm self-host:image` builds the static image only. Server mode uses `server.image` and the command above;
the image compiles `VITE_COLLAB=server`. Its supported build arguments are `VITE_BRAND_NAME`, `VITE_LOCALES`,
`VITE_DISABLE_ONDEVICE` and `FRAME_ANCESTORS`. The `build` annotation remains descriptive metadata.

Server mode forces one replica and `Recreate`, regardless of `replicas`: rooms live in one process. It runs
as distroless UID/GID 65532 with a read-only root and no writable mounts. Readiness uses `/readyz`, liveness
uses `/healthz`. `build.basePath` sets both the ingress prefix and `LD_BASE`. The chart pins `LD_HOST`,
`LD_PORT` and `LD_STATIC_DIR` to the image's listener and site layout. Put other runtime settings in
`server.env`, using strings, for example:

```yaml
mode: server
server:
  env:
    LD_ORIGIN: https://diagrams.example.com
    LD_TRUST_PROXY: "1"
    LD_TRUST_PROXY_HOPS: "1"
    LD_ROOM_CAP: "8"
    LD_SOCKETS_PER_IP: "64"
```

Helm merges these with the defaults. All [documented runtime settings](../../../docs/SELF-HOSTING.md#server-settings)
are accepted. Only enable proxy trust when a NetworkPolicy/firewall prevents direct client access to the pod
and every path has the same trusted forwarding chain. The chart installs no NetworkPolicy, SSO or VPN.

Server resources use `server.resources`, independently of static `resources`: 256 MiB requested and
512 MiB limit by default, with 128 MiB total outbound buffers, 16 MiB per socket and 32 sockets.
See the [memory formula](../../../docs/SELF-HOSTING.md#deployment-and-access) before raising these settings.
The server rejects outbound budgets above 25% of a detected container limit before listening.

The ingress defaults nginx-ingress `proxy-read-timeout` and `proxy-send-timeout` annotations to `3600`
seconds; explicit values in `ingress.annotations` take precedence.
Other controllers may ignore them: configure their equivalent WebSocket idle/read/send timeouts and upgrade
support in `ingress.annotations` or controller settings. Terminate TLS at the ingress and set `LD_ORIGIN`
to its public HTTPS origin. Authenticate the site and WebSocket path at your SSO proxy, or restrict access
to your VPN. Restarts reconnect and resync from browsers; the server persists nothing.

Run `node scripts/self-host-chart-test.mjs` for static byte parity and both server path variants. CI lints
and templates both modes in **Self-host image and chart**.
