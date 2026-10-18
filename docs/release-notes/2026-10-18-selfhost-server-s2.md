## Self-hosted server: UI hosting and operations (S2)

The optional Node server can now serve the built UI and the encrypted collaboration relay from
one listener, including under a base path. It serves MIME types, SPA navigation, immutable assets,
uncached HTML, and negotiated streaming Brotli/gzip. Traversal, directory listings and symlink
escapes are refused. `LD_STATIC=off` keeps the relay-only deployment available.

Builds emit `headers.json` from the existing self-host policy generator. The server loads that
manifest before listening; `pnpm headers:self-host --out dist` can replace it with the same
embed allowlist/provider options used for nginx and Caddy. Header parity tests compare real
responses with the generated nginx configuration and the existing instance verifier, including
the OAuth page's omitted opener policy.

Health/readiness, optional aggregate Prometheus metrics, opt-in IP logging and a bounded SIGTERM
drain support operators. Readiness fails while draining; shutdown stops the listener, sends relay
close 1012 and destroys remaining connections at the deadline. Logs and metrics contain no
payloads or room identifiers. Admission includes pending upgrades and releases failed handshakes.
Tests cover exact negotiated frame-boundary delivery in both addressing modes.

This step adds no browser collaboration mode, deployment image or UI controls. No output golden
is intentionally changed or re-recorded.
