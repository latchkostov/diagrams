# Netlify

Build your pinned checkout, run `pnpm headers:self-host --frame-ancestors "https://wiki.example.com"`, then copy
generated `netlify/netlify.toml` to the deployment repository root. Connect it to Netlify and set your build
variables; the template runs `pnpm build:internal` and publishes `dist`. Do not combine it with another `_headers`.

One policy applies to all pages: allowlisted origins can frame the editor too. Keep the generated netlify.toml
in the deployment root for manual CLI deployments too; Cloudflare's header-detach syntax is not portable to Netlify.
The auth route uses explicit `unsafe-none` COOP because Netlify cannot remove an inherited header.
Verify with `--flat` and your allowlist.
See [the guide](../../../docs/SELF-HOSTING.md#netlify-vercel-and-cloudflare-pages).
