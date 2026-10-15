# nginx

Build, run `pnpm self-host:prepare --base /`, and copy the site to `/usr/share/nginx/html/`. Generate policies and include generated `nginx/nginx.conf`
inside your nginx `http {}`. The complete template listens on 8080; configure your own HTTPS/SSO proxy, or edit
listen/TLS/root settings without duplicating policy values. Test with `nginx -t`, then reload and run the verifier.

For `--base /tools/diagrams/`, put files in `/usr/share/nginx/html/tools/diagrams/` and preserve the proxy prefix.
Prepare the built HTML with the same `pnpm self-host:prepare --base /tools/diagrams/` prefix before copying it.
The config handles embed queries, CORS modules, auth-page COOP exception, gzip, immutable assets and SPA fallback.
Do not add location-level add_header directives without repeating the security headers there.
See [the guide](../../../docs/SELF-HOSTING.md#nginx-and-caddy).
