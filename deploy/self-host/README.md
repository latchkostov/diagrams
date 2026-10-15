# Self-hosting kit

Start with [the guide](../../docs/SELF-HOSTING.md). Each target below has its own README.
`pnpm schemas` refreshes committed policy samples; `pnpm headers:self-host` generates your own policies,
including `--frame-ancestors`, `--base` and optional `--providers`. Never edit generated header values by hand.

- [Docker / Compose](docker/README.md)
- [Kubernetes](kubernetes/README.md) and [Helm](helm/README.md)
- [nginx](nginx/README.md) and [Caddy](caddy/README.md)
- [Netlify](netlify/README.md), [Vercel](vercel/README.md), [Cloudflare Pages](cloudflare/README.md)
- [GitHub Pages](github-pages/README.md), [Azure](azure/README.md), [AWS](aws/README.md)

Top-level `_headers`, `nginx.conf` and `framed/` remain available as legacy header snippets. Complete nginx
server configuration lives in `nginx/` and is also used by Docker. No credentials belong in these templates.
