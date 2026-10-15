# Caddy

Build, run `pnpm self-host:prepare --base /`, generate headers, and copy bare `dist/` contents to `/srv/live-diagrams/`.
Install generated `caddy/Caddyfile`.
Validate with `caddy validate --config <file> --adapter caddyfile`, then reload and verify the deployed URL.
Replace `:8080` with your domain for automatic HTTPS; configure your SSO proxy separately.

For `--base /tools/diagrams/`, the config strips the prefix internally; files remain at `/srv/live-diagrams/`.
Prepare built HTML using that same `pnpm self-host:prepare --base /tools/diagrams/` prefix before copying it.
It selects embed CSP by query and supplies script CORS/CORP, auth COOP exception, zstd/gzip and caching.
See [the guide](../../../docs/SELF-HOSTING.md#nginx-and-caddy).
