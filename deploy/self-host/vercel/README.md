# Vercel

Build first with `pnpm build:internal`, then generate your policy with `pnpm headers:self-host`. Copy generated
`vercel/vercel.json` into `dist/` and deploy the static directory with `vercel deploy dist`. The generated config
has no public-site branch restrictions and picks embed CSP by query. Verify with your framing allowlist.

For repository deployments, install this config at the deployment root before deployment and set the project's
build command to `pnpm build:internal`, output `dist`. The repository's build regenerates the root public config;
do not copy that public config to a self-hosted static deployment. Follow the separate generated self-host copy.
See [the guide](../../../docs/SELF-HOSTING.md#netlify-vercel-and-cloudflare-pages).
