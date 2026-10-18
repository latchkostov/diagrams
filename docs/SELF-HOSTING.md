# Self-hosting Live Diagrams

Live Diagrams is a static site: HTML, JavaScript, CSS, bundled fonts and icons. There is no application backend,
database, account service or telemetry. You provide HTTPS, file serving and, if needed, your own sign-in gate.

## Choose a target

| Target                                                                      | Choose it when                                   | Security headers / framing                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| [Docker / Compose](#docker-and-compose)                                     | You want a ready-to-serve container              | Generated nginx policy; query-specific embed allowlist           |
| [Kubernetes / Helm](#kubernetes-and-helm)                                   | You already run a cluster                        | Same container, probes, replicas and optional TLS ingress        |
| [nginx / Caddy](#nginx-and-caddy)                                           | You already have a web server or SSO proxy       | Full headers; query-specific embed allowlist                     |
| [Netlify / Vercel / Cloudflare Pages](#netlify-vercel-and-cloudflare-pages) | You want managed static hosting                  | Full headers; Netlify/Pages use one framing policy for all pages |
| [Azure Static Web Apps](#azure-static-web-apps)                             | Your organisation uses Azure / Entra             | Full headers; one framing policy; optional platform auth         |
| [S3 + CloudFront](#s3-and-cloudfront)                                       | You want a private bucket and CDN                | Generated response policies per cache behaviour                  |
| [GitHub Pages](#github-pages)                                               | A public, low-maintenance copy is sufficient     | No custom HTTP headers; meta-CSP cannot restrict framing         |
| [Offline bundle](#air-gapped-and-offline-networks)                          | Build outside a closed network and copy files in | Site, policies, docs and checksums in one archive                |

Templates and short target READMEs are in [deploy/self-host/](../deploy/self-host/). They contain no credentials.
All policies derive from `scripts/security-headers.ts`; regenerate them instead of copying CSP strings by hand.

## Build and lock it down

Use Node.js 22 and pnpm 10 (the repository pins pnpm via `packageManager`). Pin a release commit or tag:

```sh
git clone https://github.com/latchkostov/diagrams.git live-diagrams
cd live-diagrams
git checkout <release-commit-or-tag>
corepack enable
pnpm install --frozen-lockfile
VITE_BRAND_NAME="Acme Diagrams (internal)" pnpm build:internal
```

Deploy the contents of `dist/`. Its paths are relative, so the same build works at `/` or a directory such as
`/tools/diagrams/`. Use a trailing slash at that address. PowerShell: set
`$env:VITE_BRAND_NAME = "Acme Diagrams (internal)"` first, then run `pnpm build:internal`.

For a server with SPA fallback at arbitrary deep paths, run `pnpm self-host:prepare --base /tools/diagrams/`
after building (use `--base /` for root hosting). This adds a base tag to built index.html so its relative assets
resolve to your directory. It does not edit application source; Docker and offline packaging do this automatically.

These switches retain their existing behaviour. They are compiled into JavaScript; changing a container's
runtime environment or a Helm value cannot change them. Rebuild the site/image after changing a switch.

| Build variable             | Normal build  | Internal build | Effect when set to `1`                                                                                            |
| -------------------------- | ------------- | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `VITE_DISABLE_SHARE_LINKS` | off           | **1**          | Removes share links, password links and URL embeds. File exports and host-supplied private embeds stay available. |
| `VITE_DISABLE_LINK_OPEN`   | off           | off            | Stops opening `#d=` / `#e=` links, including in embeds. Host-supplied embeds still work.                          |
| `VITE_DISABLE_AI_TOOLS`    | off           | **1**          | Removes browser-agent tools, Copy for AI, copied prompts and Build with AI.                                       |
| `VITE_DISABLE_ONDEVICE`    | off           | off            | Removes Chrome's on-device model and its microphone; with AI tools off, removes the AI panel.                     |
| `VITE_PRIVATE_BY_DEFAULT`  | off           | **1**          | Starts new diagrams Private; people can still change that setting.                                                |
| `VITE_BRAND_NAME`          | Live Diagrams | Live Diagrams  | Your name in the top bar and page title (up to 60 characters).                                                    |
| `VITE_LOCALES`             | all           | all            | Comma-separated languages, default first, e.g. `de,en`. One language removes the language choice.                 |

A boolean is on with `1`, `true`, `yes` or `on`. Shell variables override Vite's `.env` files; internal defaults
apply only to unset variables. Set `0` explicitly to override an internal default. The container treats empty
optional build arguments as unset. `build:internal` prints the resolved settings.

For a closed network, also disable link opening and the on-device model:

```sh
VITE_DISABLE_LINK_OPEN=1 VITE_DISABLE_ONDEVICE=1 VITE_LOCALES=en pnpm build:internal
```

Cloud storage is off unless you set `VITE_GOOGLE_*`, `VITE_ONEDRIVE_*` or `VITE_DROPBOX_*` variables. Leave them
unset for an offline deployment. If you intentionally configure a provider, generate headers with `--providers`
and follow [INTEROP.md](INTEROP.md#storage-providers) for its registration and redirect URLs. Never put client
secrets in `VITE_*`: those values are public build inputs. Container builds exclude `.env` files; the supplied
image recipe supports the switches above, rather than provider credentials.

The default internal build still offers Chrome's on-device model. Chrome downloads that model once; dictation
may use its online speech service. CSP limits page requests, not browser services or extensions. Disable
on-device features and manage browser policy where zero external traffic is required.

## Generate your headers

Without cloud storage, generated policies permit no external script, frame or connection origins. The editor
may be framed only by itself; embeds (`?embed`, with any value) may also be framed by your listed origins:

```sh
pnpm headers:self-host --frame-ancestors "https://wiki.example.com https://*.example.com"
pnpm headers:self-host --base /tools/diagrams/ --frame-ancestors "https://wiki.example.com"
pnpm headers:self-host --providers   # only for intentionally configured cloud storage
```

Output goes to ignored `self-host-headers/`; `--out <directory>` changes it. It includes nginx, Caddy, Netlify,
Vercel, Pages, Azure, AWS and GitHub Pages policies. HTTPS origins only (localhost HTTP is allowed for testing).
The default allowlist is empty. Checked-in `framed/` files use example domains; replace them.

Netlify, Cloudflare Pages, Azure and CloudFront response policies cannot distinguish the editor from an embed
by query. With an allowlist, their generated policy allows those origins to frame the whole app too. Use nginx,
Caddy or Vercel if the editor must remain same-origin-only. When providers are enabled on a flat host, both
editor and embeds receive the app's provider resource permissions; the viewer still never calls those providers.
Meta-CSP does **not** enforce `frame-ancestors`;
use a host with HTTP security headers for sensitive deployments.

## Confluence Data Center

Install the [user-macro recipe](../deploy/self-host/confluence-dc/README.md) to render an attachment or
inline Diagram file JSON using your self-hosted `<live-diagram>` component. The Confluence page supplies
the data with its own session and permissions; the viewer holds it only in memory. No public diagram URL
is created. The macro always starts still and offers click-to-play, even for files saved to play on open.

Generate and deploy your viewer's HTTP headers with the Confluence **origin**, without its context path:

```sh
pnpm headers:self-host --frame-ancestors "https://wiki.example.com"
# For a viewer served under /tools/diagrams/:
pnpm headers:self-host --base /tools/diagrams/ --frame-ancestors "https://wiki.example.com"
```

Install the generated policy for your chosen host (see above); running the command alone does not change
your server. Keep the embed-script CORS headers for both `embed/live-diagram.js` and the recipe's
`embed/confluence-dc.js`. Query-aware policies allow the wiki to frame `?embed=1&host=1`, while the editor
remains same-origin-only. Query-blind hosts allow the listed origin to frame the whole site. Check that
an upstream proxy does not add a conflicting CSP or `X-Frame-Options: SAMEORIGIN`/`DENY` to embeds.

Serve the viewer shell, its assets and both embed modules outside SSO, while protecting the editor and
Confluence attachments. These are static code, without diagram data. A frame behind cross-site SSO may
fail when third-party cookies are blocked or a login page refuses framing. A same-site viewer such as
`https://diagrams.example.com` beside `https://wiki.example.com` can help with cookie restrictions;
test your actual authentication policy. The robust option is an ungated viewer with gated attachments.

In Confluence's existing CSP, add the viewer origin to **both `script-src` and `frame-src`** (and
`script-src-elem` if explicitly present). For example, extend each applicable source list with
`https://diagrams.example.com`, retaining the existing sources. The recipe uses external module scripts;
it needs neither inline scripts nor `eval`. Attachment fetching uses Confluence's own origin, so keep
`connect-src 'self'`. Keep the viewer's policy separate from the wiki's policy: `frame-ancestors` says
who may embed the viewer; the wiki's `frame-src` says which viewer it may load.

Data Center gets a user macro rather than a Java plugin: it reuses the existing viewer and avoids a
separate plugin release cycle for a product approaching
[Atlassian's announced end of life on March 28, 2029](https://www.atlassian.com/licensing/data-center-end-of-life).
This recipe covers Data Center only; Cloud integration and embed-destination UI are separate work.

## Docker and Compose

```sh
docker build -t live-diagrams:local \
  --build-arg VITE_BRAND_NAME="Acme Diagrams (internal)" \
  --build-arg VITE_DISABLE_ONDEVICE=1 \
  --build-arg FRAME_ANCESTORS="https://wiki.example.com" .
docker run --rm -p 127.0.0.1:8080:8080 live-diagrams:local
```

Open `http://localhost:8080/`. The multi-stage image builds with pnpm and serves with nginx-unprivileged as UID
101 on port 8080. Only built files and generated config enter the final image. It has a `/healthz` healthcheck,
gzip, immutable hashed assets, revalidated HTML and an SPA fallback; missing assets/modules return 404.
Terminate HTTPS at your reverse proxy. gzip works without installing an optional Brotli nginx module.

All switches, brand and locales above are Docker build arguments. `BUILD_PROFILE=internal` is the default;
`BUILD_PROFILE=public` uses `pnpm build` defaults, while retaining the self-host policy. Build with
`BASE_PATH=/tools/diagrams/` to serve only that directory (and `/healthz`). The image redirects the slashless
directory URL. Keep the ingress/proxy path intact; do not strip it for a sub-path image.

Compose reads the same variables from your shell or Compose `.env` (not copied into the image):

```sh
VITE_BRAND_NAME="Acme Diagrams" VITE_LOCALES=en BASE_PATH=/tools/diagrams/ docker compose up --build -d
docker compose logs diagrams
docker compose down
```

Compose binds loopback and uses a read-only filesystem, writable `/tmp` and no Linux capabilities. Put it behind
your HTTPS/SSO proxy. `pnpm self-host:smoke` builds root and sub-path images, starts them on loopback 6225/6226,
checks headers, caching, gzip and routing, then removes both containers. CI runs it without publishing images.

## Kubernetes and Helm

Build an image with your arguments, give it a versioned tag and make it available to your cluster (load it into
a local cluster, or push it to **your** private registry). No image is published by this project.

```sh
kubectl apply -f deploy/self-host/kubernetes/manifest.yaml
# Optional: edit host, ingress class, TLS secret and issuer first:
kubectl apply -f deploy/self-host/kubernetes/ingress.example.yaml
```

Change the Deployment's image first. Examples provide replicas, resource limits, non-root pods, read-only
filesystems, writable `/tmp`, health probes and a Service. The optional Ingress assumes you already installed
an ingress controller; the cert-manager annotation is an example, not an installed TLS service.

```sh
helm lint deploy/self-host/helm
helm upgrade --install diagrams deploy/self-host/helm \
  --set image.repository=registry.example.com/live-diagrams --set image.tag=<release> \
  --set ingress.enabled=true --set ingress.host=diagrams.example.com \
  --set ingress.tls.enabled=true --set ingress.tls.secretName=diagrams-tls
```

Use a values file for replicas, resources, ingress annotations and build metadata. `build.switches`,
`build.profile`, `build.basePath` and `build.frameAncestors` describe the image you built; they are recorded as a
pod annotation, **not** injected as ineffective runtime `VITE_*` variables. Build a matching image first.
The ingress path follows `build.basePath`; set it to the image's `BASE_PATH`. Do not enable path rewriting.

To build directly from that values file, set its image repository/tag and run:

```sh
pnpm self-host:image my-values.yaml
# Load or push the resulting image into your own cluster, then:
helm upgrade --install diagrams deploy/self-host/helm -f my-values.yaml
```

This passes the chart's switches, profile, path and framing origins to Docker as build arguments. It builds
locally and does not push to a registry. Use a complete values file based on the chart's `values.yaml`.

## nginx and Caddy

1. Build the site, prepare its base tag with `pnpm self-host:prepare --base <path>/`, and generate headers with
   the same allowlist and path.
2. nginx: copy files to `/usr/share/nginx/html/` (or `/usr/share/nginx/html/tools/diagrams/` for a sub-path).
   Include `self-host-headers/nginx/nginx.conf` inside `http {}`. It listens on 8080; change listen/TLS and root
   settings for your server, keeping generated maps and headers. Run `nginx -t`, then reload.
3. Caddy: copy bare `dist/` contents to `/srv/live-diagrams/`. Install `self-host-headers/caddy/Caddyfile`.
   It strips a configured directory prefix internally. Replace `:8080` with your domain for automatic HTTPS;
   run `caddy validate --config <file>`, then reload. Compression is zstd/gzip.
4. Add your authentication proxy as below, then verify.

The legacy top-level `nginx.conf` is a header snippet for existing configurations; the complete server template
is in `nginx/`. Never add a location-level nginx `add_header` without repeating security headers there: nginx
otherwise drops inherited ones.

## Netlify, Vercel and Cloudflare Pages

1. Build a pinned checkout using your switches and generate headers. Managed hosts normally deploy at `/`.
2. Netlify: put generated `netlify/netlify.toml` at your deployment repository's root. Its build command is
   `pnpm build:internal`, publishing `dist`. Set switches in the platform build environment. Keep netlify.toml
   at the deployment root for manual CLI deployments too; avoid adding a second `_headers` mechanism.
   The auth route uses explicit `unsafe-none` COOP since Netlify cannot remove inherited headers; other
   templates omit that header. Cloudflare's header-detach syntax is not portable to Netlify.
3. Vercel: for a local static deploy, copy generated `vercel/vercel.json` into `dist/`, then run
   `vercel deploy dist`. No build command is needed in that directory. For a connected repository, set build
   command `pnpm build:internal` and output `dist` in project settings and install the generated self-host config
   in your deployment checkout before starting deployment. The repo's `pnpm build` regenerates the public-site
   root config, so keep a separate generated copy for self-host deployment. Self-host config has no upstream
   branch restriction.
4. Cloudflare Pages: copy `_headers` and `_redirects` from generated `cloudflare/` into `dist/` before deploying.
   For a connected build, append header generation and these copy steps to `pnpm build:internal`. These files
   apply to static assets; Pages Functions need their own response headers. The generated `_redirects` contains
   comments only: [native SPA fallback](https://developers.cloudflare.com/pages/configuration/serving-pages/#single-page-application-spa-rendering)
   preserves existing assets. Keep the root `index.html` and omit a top-level `404.html`; never add a blanket
   proxy to `index.html`, which overrides real assets. Native fallback serves the root document, so a Pages
   directory mount also needs that root document prepared with the deployment prefix; `--base` alone does not
   relocate files or change Pages' fallback target.
5. Enable HTTPS and your platform's access gate, then verify. For directory mounts, put files beneath that
   prefix and regenerate with `--base`; nginx/Caddy are the tested directory deployment options.

For example, a complete static Pages build/deploy preparation:

```sh
pnpm build:internal
pnpm self-host:prepare --base /
pnpm headers:self-host --frame-ancestors "https://wiki.example.com"
cp self-host-headers/cloudflare/_headers self-host-headers/cloudflare/_redirects dist/
# Deploy dist/ using your Pages project, then:
pnpm self-host:verify https://diagrams.example.com/ --flat --frame-ancestors "https://wiki.example.com"
```

For Vercel repository deployment, prepare your own deployment checkout before invoking the CLI:

```sh
pnpm build:internal
pnpm self-host:prepare --base /
pnpm headers:self-host --frame-ancestors "https://wiki.example.com"
cp self-host-headers/vercel/vercel.json vercel.json
# Set the Vercel project's build command to pnpm build:internal and output directory to dist.
vercel deploy
```

The CLI reads self-host configuration before starting the remote build. Reinstall that config before every
deployment; for automation, include generation/copy in your deployment preparation step. The file-only
`vercel deploy dist` option avoids repository build/config regeneration entirely.

## Azure Static Web Apps

1. Configure an app with no API, build `pnpm build:internal`, output `dist` and your build environment variables.
2. Copy generated `azure/staticwebapp.config.json` into `dist/` **after** building.
3. If sign-in is required, add `allowedRoles: ["authenticated"]` to protected routes and a catch-all last.
   Azure evaluates routes in order: early matching asset/embed/auth header routes also need `allowedRoles`
   when they require auth. Exempt viewer code only if your access design intentionally makes it reachable.
4. For tenant-specific Entra login, configure a custom provider and 401 login redirect. Use issuer
   `https://login.microsoftonline.com/<TENANT_ID>/v2.0`; `clientIdSettingName` and `clientSecretSettingName` name
   platform app settings. Keep the secret there, never in config or Vite variables. Custom auth needs the
   appropriate Azure plan. Register `https://<host>/.auth/login/aad/callback` and use enterprise-app assignment
   to restrict membership.
5. Deploy and verify. The supplied template configures headers/routing, not your identity provider.

[Azure configuration reference](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration) covers
route precedence, header overrides and authentication settings.

## S3 and CloudFront

1. Upload `dist/` to a private bucket. Use CloudFront Origin Access Control, HTTPS and default root object
   `index.html`; keep public access blocked. Set S3 HTML metadata to `Cache-Control: no-cache`, hashed assets
   to `public, max-age=31536000, immutable`, and unversioned embed code to the generated hour-long policy.
2. Create the generated response policies:

   ```sh
   aws cloudfront create-response-headers-policy --response-headers-policy-config file://self-host-headers/aws/response-headers-policy.json
   aws cloudfront create-response-headers-policy --response-headers-policy-config file://self-host-headers/aws/embed-response-headers-policy.json
   aws cloudfront create-response-headers-policy --response-headers-policy-config file://self-host-headers/aws/auth-response-headers-policy.json
   aws cloudfront create-response-headers-policy --response-headers-policy-config file://self-host-headers/aws/assets-response-headers-policy.json
   ```

3. Attach the app policy to default behaviour, the embed-script policy to `embed/*.js`, and auth policy to
   `auth.html`, and the assets policy to `assets/*`. Use an immutable asset cache policy and matching S3 metadata.
   Set default HTML minimum TTL to zero and enable compression.
   Set embed behaviour TTL to match its generated header. Response headers alone do not set CDN cache TTLs.
4. For arbitrary SPA paths, use a viewer-request rewrite to `index.html` only for non-file app routes. Do not
   globally map all 403/404 to HTML: missing modules must remain errors. Normal app views use query parameters.
5. Add your organisation's authentication at viewer request, e.g. OIDC through Lambda@Edge. CloudFront Functions
   cannot perform an OAuth token exchange. Verify with `--flat` and your framing allowlist.

See [CloudFront response policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/creating-response-headers-policies.html).
They set headers, not access control, cache keys or TLS. For sub-paths, prefix S3 keys and behaviour patterns
consistently; `--base` does not create a distribution.

## GitHub Pages

1. Build an internal copy, create `dist/.nojekyll`, and insert generated `github-pages/meta-csp.html` at the
   **start** of `dist/index.html`'s `<head>`, before scripts/resource links.
2. Deploy `dist/` using Pages upload/deploy actions or a Pages branch. For project Pages, use the trailing-slash
   repository directory URL; asset paths are relative.
3. Pages cannot set custom CSP, Permissions-Policy, COOP, CORP or Referrer-Policy HTTP headers. Meta-CSP covers
   resource loading only for the HTML into which it was inserted, ignores `frame-ancestors` and does not protect
   other static pages. Cross-origin embeds depend on platform CORS. The verifier reports these limitations;
   **a Pages-only deployment cannot pass security verification**.
4. For enforced headers or an access gate, put a configured Cloudflare proxy/Worker in front (set generated
   headers there), or choose another host. Pages alone is not the recommended private host.

## Air-gapped and offline networks

Run on a connected build machine (dependencies must already be cached to build without internet):

```sh
pnpm package:offline --frame-ancestors "https://wiki.example.com"
# Optional: --base /tools/diagrams/ --out /path/to/artifacts
```

It builds a locked internal copy (links, outside AI and on-device features off, new diagrams Private), preserves
brand/language settings, and rejects configured cloud-storage variables, including `.env` files. Output is
`offline-output/live-diagrams-<package-version>-<commit>.tar.gz`, with an adjacent `.sha256`. Inside: `site/`,
generated `headers/`, public deployment docs, LICENSE, VERSION and per-file SHA256SUMS. No runtime Node.js or
package manager is needed. Serve over internal HTTPS; opening the editor from `file://` does not support modules.

```sh
sha256sum -c live-diagrams-<version>-<commit>.tar.gz.sha256
tar -xzf live-diagrams-<version>-<commit>.tar.gz
cd live-diagrams-<version>-<commit>
sha256sum -c SHA256SUMS
```

Copy `site/` to your web root and install the corresponding header config. Assets are bundled; `connect-src`,
`script-src`, `frame-src` permit only the serving origin. Existing self-host e2e checks enforce no requests outside
that origin. Browser-service traffic still requires browser/network policy; CSP cannot govern it. Checksums
check corruption, not authenticity: use a trusted transfer channel and build a pinned, reviewed commit. Archives
made from a dirty checkout have a `-dirty` suffix; they are not release artifacts and should not be distributed.

## Behind SSO or a reverse proxy

Keep HTTPS, path prefix, query strings and generated headers intact. Authenticate the editor and viewer iframe
at your existing proxy. Never put OAuth secrets in templates. For nginx with oauth2-proxy, add `/oauth2/` proxy
routes and an internal `/oauth2/auth` endpoint, then `auth_request /oauth2/auth` on protected site locations and
a 401 sign-in redirect. Forward Host, scheme and original request URI correctly. Keep `/healthz` available to
probes. Store identity-provider secrets in your proxy's secret store.

Private embeds use [EMBEDDING.md](EMBEDDING.md)'s host-supplied protocol: your page fetches its diagram with its
own authentication/cookies and hands it to the viewer in memory. The diagram is never in the iframe URL, never
saved by the viewer and never fetched by the static site. Load `<your-site-directory>/embed/live-diagram.js`;
the component discovers the viewer directory relative to its own script URL, including a sub-path.

Keep `/embed/` reachable. Cross-origin module requests do not carry the viewer's login cookie by default and
cannot execute a sign-in redirect as JavaScript. You may exempt `/embed/*.js` from SSO: it is viewer code, never
diagram data. Generated CORS/CORP lets other origins load it. The iframe itself still needs its normal site
files and, if gated, a valid session. Do not redirect asset requests to login HTML.

As EMBEDDING.md describes, `src-json` is fetched by the **host page** with same-origin credentials by default;
use `credentials="include"` only for a cross-origin API that permits credentials and the exact host origin.
Cross-site iframe sessions may fail under third-party-cookie restrictions even with `SameSite=None; Secure`.
Prefer the wiki and viewer on the same schemeful site (e.g. `wiki.example.com` and `diagrams.example.com`), or
one site/path. `frame-ancestors` allows framing; it does not grant access or fix cookies. Add your viewer origin
to the host page's `script-src` and `frame-src` as EMBEDDING.md describes.

## Verify the deployed instance

From a checkout with dependencies installed:

```sh
pnpm self-host:verify https://diagrams.example.com/ --frame-ancestors "https://wiki.example.com"
pnpm self-host:verify https://diagrams.example.com/tools/diagrams/ --frame-ancestors "https://wiki.example.com"
# Netlify, Cloudflare Pages, Azure or CloudFront with one policy for all pages:
pnpm self-host:verify https://diagrams.example.com/ --flat --frame-ancestors "https://wiki.example.com"
```

Use `--providers` only if your headers retained provider origins. Checks cover HTTP 200, content types, CSP
(including embed frame-ancestors), module CORS/CORP/cache, Referrer-Policy, Permissions-Policy, nosniff and COOP;
auth.html must omit COOP (or explicitly use `unsafe-none`) so OAuth popups can return. The script exits nonzero on problems and does not follow
SSO redirects. For an authenticated check, set `SELF_HOST_VERIFY_COOKIE` locally to a test session cookie, run
it, then unset it; the value is never printed. It verifies serving configuration, not your identity provider.

Also check the browser console and Network panel during editing, exports, simulation and an embed: no CSP
violations or unexpected origins. Headers alone cannot prove every browser interaction works.

## Upgrading

1. Read [RELEASE-NOTES.md](RELEASE-NOTES.md), pin the next release, and install with the lockfile.
2. Rebuild with the same switches, brand, locales, path and allowlist; use a new image tag.
3. Regenerate policies and compare. Deploy site/headers together, verify, and keep the previous release for
   rollback. Retain old hashed assets briefly for tabs still running the old build.
4. Revalidate HTML; never make `index.html` immutable. Helm: `helm upgrade`, or roll back to previous values/tag.

Browser-saved diagrams persist at the same origin (scheme, host and port). Older `diagrams/v1` files open in
newer releases. Before changing origin, ask people to export and reopen their diagrams; browser storage does
not move with the site. A directory prefix does not isolate localStorage: copies at one origin share it.

## Troubleshooting

| Symptom                                  | Check                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Blank page / module served as HTML       | Preserve trailing slash and prefix; missing modules must be 404, not SPA/login HTML.              |
| CSP violation / missing headers          | Regenerate; remove duplicate proxy policies and run the verifier.                                 |
| Embed refuses framing                    | Use the exact host-origin allowlist; remove conflicting X-Frame-Options or a stricter second CSP. |
| Embed fails CORS                         | Keep `/embed/*.js` reachable with ACAO/CORP; do not redirect modules to SSO.                      |
| Iframe repeatedly asks for login         | Check schemeful site, third-party-cookie policy and session cookies.                              |
| OAuth popup loses opener                 | Omit COOP on auth.html; register the correct host/path redirect URI.                              |
| Switch / language did not change         | Rebuild; runtime env and Helm metadata cannot change compiled settings.                           |
| Old app after upgrading                  | Revalidate HTML; check CDN minimum TTL and retain old assets during rollout.                      |
| Empty Your diagrams after moving         | Export from the old origin, then import at the new one.                                           |
| Docker fails to start                    | Check Linux daemon, port conflicts, logs, `nginx -t` and writable `/tmp` in read-only mode.       |
| Encrypted export / recording unavailable | Use HTTPS; WebCrypto and capture APIs are restricted on plain HTTP intranets.                     |

## Data and privacy

Diagrams live in browser local storage for your origin, on each person's device. Storage is unencrypted; there
is no server backup. Export diagram files for backup. PNG, SVG, draw.io, Mermaid and Interactive HTML exports
are generated in the browser and downloaded. Interactive HTML is self-contained and can be password-encrypted;
private embeds keep diagrams in memory only.

There are no requests to livediagrams.dev, analytics or CDN fonts/icons in a self-hosted, provider-free build.
Configured cloud storage sends data to a provider only when used. AI/clipboard exports and browser services
remain subject to enabled features and organisational policies. Static hosts and SSO proxies may log web
requests but receive no diagram content from browser-local editing. Review browser extensions separately.
Replace built public-site privacy/terms pages with your policies if needed; unused `skill/`,
`livediagrams-skill.zip` and `llms.txt` can be removed.
