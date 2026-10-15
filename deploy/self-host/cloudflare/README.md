# Cloudflare Pages

Build with `pnpm build:internal`, generate headers for your domains, then copy generated `cloudflare/_headers`
and `_redirects` into `dist/`. Deploy that directory to Pages; for a connected build, append generation/copy steps
to the build command. Configure Cloudflare Access separately if needed.

Keep a root `index.html` and no top-level `404.html` to enable Pages' native SPA fallback. The generated
`_redirects` contains comments only: a catch-all proxy would override real JavaScript and other static assets.
For directory mounts, native fallback still serves the root document: prepare that document with your prefix
and put assets beneath the same prefix. nginx/Caddy are the tested directory hosting options.

Static Pages headers cannot distinguish embeds by query: an allowlist permits framing the editor too.
Verify with `--flat`. Pages Functions must set headers themselves; these files apply to static responses.
See [the guide](../../../docs/SELF-HOSTING.md#netlify-vercel-and-cloudflare-pages).
