## Collaboration server image and deployment variants

The self-host collaboration server now has a multi-stage image with the internal UI and relay in a
non-root distroless Node 24 runtime. The same image supports different origins and `LD_BASE` paths;
`LD_STATIC=off` serves only the relay. Its compose service uses a read-only root, drops all capabilities
and requires no writable mounts. Healthchecks use the bundled Node entry point.

Generated Caddy and nginx variants proxy the complete server, with separate relay-only snippets for an
existing static host. The Docker smoke checks headers, two-browser editing, log privacy and the 80 MB
compressed layer budget. CI runs both static and server image smoke tests; `gate --no-docker` explicitly
skips them. No image is published.

Server room-capacity refusals now have a separate aggregate `server-cap` metric. Shared Live browser
tests wait for the follower's replay to finish before comparing simulation digests.

Output parity goldens are unchanged; this deployment step changes no diagram, simulation or export output.
