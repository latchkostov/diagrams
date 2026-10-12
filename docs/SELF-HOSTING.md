# Self-hosting

Live Diagrams is static files: HTML, JavaScript, CSS, fonts and icons. There's no server, database or account. A
company can build its own copy, put it behind its own sign-in, and keep every diagram inside its network. This page
covers the build, the switches that turn features off, hosting behind SSO, the security headers and updates.

## What stays local

Everything. A self-hosted copy built with `pnpm build:internal`:

- **Keeps diagrams in the browser.** _Your diagrams_ live in the browser's local storage for your copy's origin, on
  each person's device. Nothing is uploaded: there's no backend to upload to, yours or ours.
- **Talks only to your origin.** The app makes no requests to livediagrams.dev or anyone else. It has no analytics,
  no telemetry and no fonts or icons from a CDN. The Content-Security-Policy (below) makes the browser enforce this.
- **Makes no links.** Share links, links with a password and embed codes are gone from the menus, the right-click and
  Ctrl+K, and their code isn't in the build (`src/lib/deployment.build.test.ts` checks).
- **Offers nothing to outside AI.** No tools for browser agents (WebMCP), no Copy for AI and no copied prompts.
- **Starts new diagrams Private.** People can still turn that setting off in File ▸ Privacy.
- **Exports stay files.** Diagram file, PNG, SVG, draw.io, Mermaid and **Interactive HTML** are made in the page and
  downloaded. The Interactive HTML file is self-contained and makes no requests when opened.

What's left is up to you and your browsers:

- **Cloud storage** (Google Drive, OneDrive, Dropbox) is off unless you set its `VITE_*` variables at build time
  ([INTEROP.md](INTEROP.md#storage-providers)). Leave them unset and no provider code loads.
- **Chrome's built-in model** (the AI panel's on-device box) runs on the device. Chrome itself downloads that model
  from Google once, and its dictation may use Chrome's online speech service. `VITE_DISABLE_ONDEVICE=1` removes the
  box, its microphone and the Lab's model evals (and, with AI tools off too, the AI panel).
- **Links people send** (`#d=…`, from the public site, say) still open, because the diagram is inside the link and
  nothing is fetched. `VITE_DISABLE_LINK_OPEN=1` turns that off too.
- **Browser extensions** can read any page they're allowed on. That's a browser-policy question, not an app one.
- Diagrams in local storage are unencrypted, like any web app's. They're tied to your copy's exact origin
  (`https://diagrams.example.com`): the same browser on another origin doesn't see them.

## Build

You need Node.js 22 and pnpm 10 (`corepack enable` provides it).

```sh
git clone https://github.com/latchkostov/diagrams.git live-diagrams
cd live-diagrams
git checkout <a release commit or tag>
pnpm install --frozen-lockfile
VITE_BRAND_NAME="Acme Diagrams (internal)" pnpm build:internal
```

The site is `dist/`. Copy it to your host as is. It uses relative paths, so it works at a domain's root or under a
path (`https://intranet.example.com/tools/diagrams/`). `pnpm build:internal` is `pnpm build` (schemas, type check,
Vite build) with the internal defaults below. It prints the switches it used.

On Windows (PowerShell), set the variables first: `$env:VITE_BRAND_NAME = "Acme Diagrams (internal)"`, then
`pnpm build:internal`. Or put them in a `.env.local` file at the repository root (git-ignored), one `NAME=value` per
line.

## The switches

Each one is read once, at build time, and folded into the code: what a switch turns off isn't hidden, it isn't in the
build. Changing one means building again. `src/lib/deployment.ts` is the one place the app reads them.

| Variable                   | `pnpm build`  | `pnpm build:internal` | What it does                                                                                                                                                                                    |
| -------------------------- | ------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_DISABLE_SHARE_LINKS` | off           | **1**                 | No share links, links with a password or embed codes: not in the File menu, the right-click or Ctrl+K, and agents get no `get_share_link`.                                                      |
| `VITE_DISABLE_LINK_OPEN`   | off           | off                   | Links people send (`#d=`, `#e=`) don't open, in the app or in an embed: the address bar is cleared and a message says so. File ▸ Import from ▸ Share link… goes too.                            |
| `VITE_DISABLE_AI_TOOLS`    | off           | **1**                 | No tools for browser agents (WebMCP), no Copy for AI, no Advanced (copied prompts) and no Build with AI. The AI panel keeps only the on-device model.                                           |
| `VITE_DISABLE_ONDEVICE`    | off           | off                   | No on-device model (Chrome's built-in one). With AI tools off as well, there's no AI panel at all.                                                                                              |
| `VITE_PRIVATE_BY_DEFAULT`  | off           | **1**                 | **New diagrams are private** starts on: diagrams people start, open from their device, import or paste start Private (no links, cloud saves or AI). People can turn the setting off; it's kept. |
| `VITE_BRAND_NAME`          | Live Diagrams | Live Diagrams         | The name in the top bar, the page title and the start-up page, e.g. `Acme Diagrams (internal)`. One line, up to 60 characters.                                                                  |

A switch is on with `1` (or `true`, `yes`, `on`); anything else is off. Values come from the shell first, then Vite's
`.env` files (`.env.production.local`, `.env.production`, `.env.local`, `.env`). `pnpm build:internal` sets its three
only when neither has them, so `VITE_DISABLE_AI_TOOLS=0` (in the shell or `.env.local`) keeps the AI tools and
`VITE_DISABLE_LINK_OPEN=1` adds that switch; it prints what it used.

With AI tools off, the AI panel keeps the on-device model's on/off switch (otherwise in Advanced), and a turn's Undo
this change and Revert to here stay whichever switches are set: they belong to the panel's history, not to a model.

**Cloud storage** has no switch: Google Drive, OneDrive and Dropbox are off unless their variables are set
(`VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_API_KEY`, `VITE_ONEDRIVE_CLIENT_ID`, `VITE_DROPBOX_APP_KEY`; see
`.env.example` and [INTEROP.md](INTEROP.md#storage-providers)). An internal OneDrive needs your own Entra app
registration with `https://<your host>/auth.html` as its SPA redirect URI; set `VITE_ONEDRIVE_TENANT` to your tenant
id to keep sign-in to your organisation.

**Optional clean-up.** `dist/skill/`, `dist/livediagrams-skill.zip` and `dist/llms.txt` are the public site's pages for
AI agents. A build without AI tools doesn't link to them; delete them if you like. `dist/privacy.html` and
`dist/terms.html` describe the public site: replace them with your own, or link your policies instead.

## Hosting behind SSO

Any static host works if it serves `dist/` over HTTPS with the headers below, and asks people to sign in before it
serves anything. The app needs no server routes: one `index.html` (views are query parameters, like `?view=canvas`),
hashed files under `assets/`, and a few static pages. Cache `assets/` for long (the names change when the content
does); don't cache `index.html`.

Put the whole site behind sign-in, embeds included: an embed in your wiki loads in an iframe, and the browser sends
your sign-in cookie with it only when the wiki and the app are the same site (subdomains of one domain). Files in
`public/` are copied into `dist/` unchanged, so a host's config file (`_headers`, `staticwebapp.config.json`,
`web.config`) can go there before you build.

### Azure Static Web Apps with Microsoft Entra ID

Deploy `dist/` as the app's output (no API). Add `staticwebapp.config.json` that lets only signed-in people in, and
only from your tenant (a custom Entra provider needs the Standard plan):

```json
{
  "auth": {
    "identityProviders": {
      "azureActiveDirectory": {
        "registration": {
          "openIdIssuer": "https://login.microsoftonline.com/<TENANT_ID>/v2.0",
          "clientIdSettingName": "AAD_CLIENT_ID",
          "clientSecretSettingName": "AAD_CLIENT_SECRET"
        }
      }
    }
  },
  "routes": [
    { "route": "/.auth/login/github", "statusCode": 404 },
    { "route": "/*", "allowedRoles": ["authenticated"] }
  ],
  "responseOverrides": { "401": { "statusCode": 302, "redirect": "/.auth/login/aad" } },
  "globalHeaders": {
    "Content-Security-Policy": "<from deploy/self-host/_headers>",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy": "<from deploy/self-host/_headers>",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups"
  }
}
```

The two settings are the client id and secret of an Entra app registration with
`https://<your app>/.auth/login/aad/callback` as a Web redirect URI. To limit it to some people, require user
assignment on the app's enterprise application.

### Amazon S3 and CloudFront with an authentication Lambda

Upload `dist/` to a private bucket and serve it through CloudFront with Origin Access Control, default root object
`index.html`. Attach a Lambda@Edge function on **viewer request** that signs people in with your identity provider
(OpenID Connect) and checks the session cookie on every request; AWS's _cloudfront-authorization-at-edge_ sample
(Amazon Cognito, which can federate your SSO) and similar open-source functions do this. CloudFront Functions can't: they can't call the token endpoint. Add the headers with a
**response headers policy** (custom headers, the values from `deploy/self-host/_headers`).

### nginx with oauth2-proxy

Run [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) against your identity provider (Entra ID, Okta,
Google Workspace, Keycloak) and let nginx ask it before serving any file. Start from `deploy/self-host/nginx.conf`
(the `map` and the headers) and add:

```nginx
server {
    # ...listen, server_name, TLS, root /srv/live-diagrams, the add_header lines from nginx.conf

    location /oauth2/ {
        proxy_pass http://127.0.0.1:4180;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Auth-Request-Redirect $request_uri;
    }
    location = /oauth2/auth {
        proxy_pass http://127.0.0.1:4180;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Uri $request_uri;
        proxy_set_header Content-Length "";
        proxy_pass_request_body off;
    }
    location / {
        auth_request /oauth2/auth;
        error_page 401 = /oauth2/sign_in;
        try_files $uri $uri/ =404;
    }
}
```

Keep `add_header` out of these `location` blocks, or repeat all the header lines there: nginx drops the inherited
ones in a block that sets its own.

### IIS on an internal network

Copy `dist/` into the site's folder. In IIS Manager, under **Authentication**, enable **Windows Authentication** and
disable **Anonymous Authentication**. Add the headers in a `web.config` beside `index.html`:

```xml
<configuration>
  <system.webServer>
    <httpProtocol>
      <customHeaders>
        <add name="Content-Security-Policy" value="(from deploy/self-host/_headers)" />
        <add name="Referrer-Policy" value="strict-origin-when-cross-origin" />
        <add name="X-Content-Type-Options" value="nosniff" />
        <add name="Permissions-Policy" value="(from deploy/self-host/_headers)" />
        <add name="Cross-Origin-Opener-Policy" value="same-origin-allow-popups" />
      </customHeaders>
    </httpProtocol>
  </system.webServer>
</configuration>
```

IIS serves only file types it knows. If a font or a JSON file answers 404, add its `mimeMap` under `staticContent`
(`.woff2` is `font/woff2`, `.json` is `application/json`).

## Headers

`deploy/self-host/` holds the security headers for a self-hosted copy, generated from the public site's policy
(`scripts/security-headers.ts`) by `scripts/self-host-headers.ts`:

| File                                   | For                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `nginx.conf`                           | nginx: a `map` (in `http {}`) and the `add_header` lines (in `server {}`).                                  |
| `_headers`                             | Netlify, Cloudflare Pages and other hosts that read a `_headers` file; copy the values to any other host.   |
| `framed/nginx.conf`, `framed/_headers` | The same, with embeds allowed in example domains (`https://intranet.example.com`, `https://*.example.com`). |

They differ from the public site's in two ways. **No outside origins:** a copy without cloud storage never calls
Google, Microsoft or Dropbox, so the policy allows only your origin (`'self'`). **Framing:** the public site lets any
site embed a diagram; these let only your own origin frame the app, and embeds only your origin and the domains you
list. Make your own:

```sh
pnpm headers:self-host --frame-ancestors "https://wiki.example.com https://*.example.com"
pnpm headers:self-host --providers   # a build with cloud storage variables: keeps their origins
```

They're written to `self-host-headers/` (git-ignored; `--out <dir>` for another place). The list takes https origins
only. nginx can send embeds (`?embed=1`) a policy of their own; a `_headers` file can't tell them apart, so with a list
the whole app may be framed by those domains.

After deploying, open the app with the browser's developer tools: the console shows any request the policy blocked
(there should be none), and the Network tab shows only your origin.

## Updating

1. Read `docs/RELEASE-NOTES.md` for changes people will notice.
2. Check out the new release, then `pnpm install --frozen-lockfile` and `pnpm build:internal` with the same variables.
3. Regenerate the headers (`pnpm headers:self-host` with your list) and compare: a release can change the policy.
4. Replace the site's files with the new `dist/`. Files in `assets/` have new names, so a stale cache can't mix
   versions; make sure `index.html` isn't cached.

People's diagrams stay in their browsers across updates: the file format (`diagrams/v1`) is versioned and older files
open in newer releases. Keep the same origin (scheme, host and port): a copy moved to a new address starts with an
empty _Your diagrams_. Before moving, ask people to export what they want to keep (File ▸ Export as ▸ Diagram file) and
open it at the new address.

## Checking a build

- `pnpm test` builds the app with and without the switches and checks what each one removes
  (`src/lib/deployment.build.test.ts`).
- The e2e suite runs two self-hosting builds (`tests/e2e/self-host.spec.ts`, `self-host-locked.spec.ts`), served with
  these headers (no CSP violations, no request outside the origin): no link,
  embed or AI-tool entry anywhere, agents get no tools, new diagrams are Private, the brand name shows, links people
  send open (or don't, with `VITE_DISABLE_LINK_OPEN`), and the Interactive HTML and diagram file exports work.
