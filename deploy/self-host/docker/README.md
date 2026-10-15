# Docker and Compose

From the repository root: `docker compose up --build -d`. The default is an internal build on
`http://localhost:8080/`, non-root nginx, read-only filesystem and writable `/tmp`. Stop with `docker compose down`.
Place it behind your HTTPS/SSO proxy. `default.conf` is generated, not copied policy text.

Use Docker build args or Compose build environment variables for all `VITE_*` switches, brand and locales;
`BUILD_PROFILE=public` selects normal build defaults. `BASE_PATH=/tools/diagrams/` mounts a directory and
`FRAME_ANCESTORS=https://wiki.example.com` permits that host to frame embeds. Rebuild for every setting change.
Runtime environment variables do not change the compiled site. `pnpm self-host:smoke` tests both path modes and
browser startup; install its browser first with `pnpm exec playwright install chromium`.
See [the guide](../../../docs/SELF-HOSTING.md#docker-and-compose).
