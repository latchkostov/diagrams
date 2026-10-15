# GitHub Pages

Build an internal copy, create `dist/.nojekyll`, insert generated `meta-csp.html` at the beginning of index.html's
head before scripts/resource links, then publish `dist` with the Pages upload/deploy actions. Relative paths work
under a project repository URL; use the trailing slash.

Pages has no custom HTTP security headers. Meta-CSP protects resource loads on that HTML only and cannot enforce
frame-ancestors, Permissions-Policy, COOP or CORP. The verifier will fail honestly. Put a configured Cloudflare
proxy/Worker in front for enforced headers, or choose a different host for sensitive/internal use.
See [the guide](../../../docs/SELF-HOSTING.md#github-pages).
