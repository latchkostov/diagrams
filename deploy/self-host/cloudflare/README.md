# Cloudflare Pages

Build with `pnpm build:internal`, generate headers for your domains, then copy generated `cloudflare/_headers`
and `_redirects` into `dist/`. Deploy that directory to Pages; for a connected build, append generation/copy steps
to the build command. Configure Cloudflare Access separately if needed.

Static Pages headers cannot distinguish embeds by query: an allowlist permits framing the editor too.
Verify with `--flat`. Pages Functions must set headers themselves; these files apply to static responses.
See [the guide](../../../docs/SELF-HOSTING.md#netlify-vercel-and-cloudflare-pages).
