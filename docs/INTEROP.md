# Import, export and storage

Everything runs in the browser. There's no backend: the app is a static site (first at
[livediagrams.dev](https://www.livediagrams.dev), deployed from this repo on Vercel). Code lives in `src/interop/`.

**Every cloud provider is optional.** Google Drive, OneDrive and Dropbox each turn on only when their
`VITE_*` variable is set at build time, and the app is fully usable without any of them: Open, Save (to
real files in Chrome and Edge, or downloads elsewhere), Your diagrams, share links and every export work
the same. With nothing set (the default, and the production deployment today) the build succeeds with no
warnings, every cloud entry is hidden, no provider code or script loads, and the browser never contacts
Google, Microsoft or Dropbox. `tests/e2e/subpath.spec.ts` checks exactly that against the production build.

## Research summary (October 2026)

| Topic                                 | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | What we did                                                                                                                                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **draw.io file format**               | `.drawio` is an `<mxfile>` with one `<diagram>` per page. Each page holds either a plain `<mxGraphModel>` (the default for `.drawio` today) or the compressed form: `encodeURIComponent(xml)`, then raw DEFLATE, then base64. Cells may be wrapped in `<object>`/`<UserObject>` to carry custom properties. Child geometry is relative to its container. `.drawio.svg` embeds the mxfile in the SVG's `content` attribute.                                                                                                                                                                         | Read every variant. Write uncompressed, with our fields as `<object>` properties, so a round trip is lossless.                                                                                                                                                       |
| **draw.io shape names**               | Azure: image shapes `image=img/lib/azure2/<category>/<Name>.svg` (checked against `jgraph/drawio` `img/lib/azure2/**`). AWS: `shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.<name>` (`lambda`, `sqs`, `sns`, `eventbridge`, `kinesis_data_streams`, `ecs`, `step_functions`, `s3`, `dynamodb`, `api_gateway`, `elastic_load_balancing`), with groups `mxgraph.aws4.group;grIcon=…`. Kubernetes: `shape=mxgraph.kubernetes.icon2;prIcon=pod / deploy / …`. There's no built-in Kafka, RabbitMQ or Postgres shape.                                                                            | Mapping table in `src/interop/drawio/mapping.ts`. Stencils with no built-in shape export as an image style with our SVG icon inlined (`image=data:image/svg+xml,<base64>`). Checked by rendering an export in app.diagrams.net.                                      |
| **Mermaid flowchart**                 | `flowchart`/`graph` with `TB/TD/BT/RL/LR`. Node shapes: `[]` `()` `([])` `[[]]` `[()]` `(())` `{}` `{{}}` `>]` `[//]`, plus the newer `id@{ shape: cyl, label: "…" }`. Links: `-->` `---` `-.->` `==>` `--o` `--x` `<-->` `~~~`. Link labels as `-->                                                                                                                                                                                                                                                                                                                                               | text                                                                                                                                                                                                                                                                 | `or`-- text -->`. Also `&`lists, chains,`subgraph id [title] … end`, and `%%` comments. | Parser in `src/interop/mermaid/read.ts`, writer in `write.ts`. |
| **Google Identity Services (GIS)**    | Static SPAs use the _token model_: `google.accounts.oauth2.initTokenClient({ client_id, scope, callback })`, then `requestAccessToken()` inside a click (a popup). Tokens last about an hour. With `prompt: ''`, a returning user gets a new token without a consent screen. No client secret, no backend.                                                                                                                                                                                                                                                                                         | `src/interop/gdrive/google.ts`. Scripts load lazily (preloaded when the File menu opens).                                                                                                                                                                            |
| **Drive scope**                       | `https://www.googleapis.com/auth/drive.file` is per-file access: only files the user picked with the Picker or that this app created. It's a non-sensitive scope, so Google needs no security assessment, just brand verification for production.                                                                                                                                                                                                                                                                                                                                                  | `drive.file` only.                                                                                                                                                                                                                                                   |
| **Google Picker**                     | Load `https://apis.google.com/js/api.js`, then `gapi.load('picker')`. Build with `PickerBuilder().addView(DocsView).setOAuthToken().setDeveloperKey(API_KEY).setAppId(PROJECT_NUMBER)`. `setAppId` must be the Cloud project **number**: it's what grants `drive.file` access to picked files. The API key must allow the app's referrers.                                                                                                                                                                                                                                                         | Mime-filtered `DocsView` (JSON, draw.io, XML, text, SVG). `appId` defaults to the client id's numeric prefix.                                                                                                                                                        |
| **Drive API v3**                      | Create: `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart` (body `multipart/related`: JSON metadata part, then content part). Update in place: `PATCH …/upload/drive/v3/files/{id}?uploadType=multipart`. Read: `GET …/drive/v3/files/{id}?alt=media`.                                                                                                                                                                                                                                                                                                                   | `src/interop/gdrive/client.ts`, unit-tested with a fake `fetch`. Files are `application/json` named `*.diagram.json`. A custom MIME type would hide them from Drive's preview and other apps for no real gain.                                                       |
| **File System Access API**            | `showOpenFilePicker` / `showSaveFilePicker` return handles you can write to again (true "Save"). Chrome and Edge on desktop only. Not in Firefox or Safari, and blocked in cross-origin iframes. Permission must be re-requested after a reload.                                                                                                                                                                                                                                                                                                                                                   | Used when available (Ctrl+S re-writes the same file). Fallback: download, plus `<input type=file>`.                                                                                                                                                                  |
| **Web Share API**                     | `navigator.share({ title, url })` works in Safari, on Android and in Chrome/Edge on Windows/ChromeOS; desktop Firefox doesn't support it.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | "Share…" button in the share-link dialog, shown only where supported.                                                                                                                                                                                                |
| **CompressionStream**                 | `deflate-raw` works in Chrome 103+, Firefox 113+, Safari 16.4+ and Node 18+.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Share links and draw.io decompression. No `pako`/`fflate`.                                                                                                                                                                                                           |
| **Microsoft identity platform (SPA)** | A static SPA uses the auth code flow with PKCE; no secret. The redirect URI must be registered under the **Single-page application** platform: that's what makes the `/token` endpoint answer cross-origin (otherwise `AADSTS9002326`). The `common` tenant takes personal and work or school accounts. With `offline_access`, an SPA gets a refresh token that lasts **24 hours** (it can't be extended), after which the user signs in again, usually with no prompt. MSAL.js (`@azure/msal-browser`) wraps this, but adds about 30 KB gzipped plus caching and ID-token handling we don't need. | Hand-rolled PKCE, no new dependency (`src/interop/storage/oauth.ts`, about 250 lines, unit-tested). Popup, not redirect, so the open diagram and undo history survive sign-in. Tokens in memory only.                                                                |
| **Popup sign-in and opener policy**   | Sign-in pages may send `Cross-Origin-Opener-Policy`, which cuts a popup off from its opener: `window.opener` is null and `popup.closed` reads true while the user is still signing in. A same-origin **BroadcastChannel** still connects the two.                                                                                                                                                                                                                                                                                                                                                  | The popup returns to a tiny static `public/auth.html` that posts the redirect's query on a BroadcastChannel (and to `opener` when it can), strips it from the URL and closes. The app treats the popup as closed only once it has focus again and no result arrived. |
| **OneDrive: scope and app folder**    | `Files.ReadWrite.AppFolder` limits the app to `Apps/<app registration name>` in the user's OneDrive, created on first use (`/me/drive/special/approot`). Microsoft's app-folder guide says it works for OneDrive personal and for work or school (the permissions reference still lists it as personal only; the work-account path needs a real tenant to confirm).                                                                                                                                                                                                                                | Least privilege: `Files.ReadWrite.AppFolder offline_access`. Saved files land in **Apps › Diagrams**.                                                                                                                                                                |
| **OneDrive File Picker v8**           | Hosted page driven by postMessage and MessagePorts. It needs SharePoint tokens (not Graph tokens), a different base URL for personal (`onedrive.live.com/picker`) and work (`<tenant>-my.sharepoint.com`) accounts, and `Files.Read`/`Files.ReadWrite` on the whole drive.                                                                                                                                                                                                                                                                                                                         | Not used: it would cost full-drive access and a second token type. Open is an in-app list of the app folder instead.                                                                                                                                                 |
| **Microsoft Graph files**             | List: `GET /me/drive/special/approot/children` (paged by `@odata.nextLink`). Create: `PUT /me/drive/special/approot:/{name}:/content?@microsoft.graph.conflictBehavior=rename`. Update: `PUT /me/drive/items/{id}/content` (simple upload, up to 250 MB). Read: `/content` answers with a 302 that browsers won't follow after a CORS preflight, so read `@microsoft.graph.downloadUrl` and fetch that pre-authenticated URL without a token.                                                                                                                                                      | `src/interop/storage/onedrive.ts`, unit-tested with a fake `fetch`. Save as never overwrites (Graph renames on a clash).                                                                                                                                             |
| **Dropbox OAuth**                     | `https://www.dropbox.com/oauth2/authorize` with `code_challenge` (S256) and the app key as `client_id`, no secret; the token endpoint `https://api.dropboxapi.com/oauth2/token` takes the `code_verifier`. Access tokens are short-lived (about 4 hours). `token_access_type=offline` adds a refresh token (usable without a secret with PKCE); `online` doesn't.                                                                                                                                                                                                                                  | `token_access_type=online`: no long-lived credential exists anywhere. When a token expires, the next action asks again, and Dropbox doesn't re-prompt a user who already allowed the app.                                                                            |
| **Dropbox API**                       | RPC calls (`files/list_folder`, `/continue`) on `api.dropboxapi.com`; content calls (`files/upload`, `files/download`) on `content.dropboxapi.com` with a `Dropbox-API-Arg` JSON header, which must escape non-ASCII as `\uXXXX`. Both hosts allow CORS. Upload paths accept `id:…`, so Save writes to the same file even after a rename. An **App folder** app sees only `Apps/<folder name>`.                                                                                                                                                                                                    | `src/interop/storage/dropbox.ts`. Save as uses `mode: add` + `autorename` (never overwrites); Save uses `overwrite` by id.                                                                                                                                           |
| **Dropbox Chooser / Saver**           | The Chooser (`dropins.js`) browses the whole Dropbox but returns only a link, not write access, so Save couldn't go back to the file. The Saver only copies from a _public URL_, not a blob.                                                                                                                                                                                                                                                                                                                                                                                                       | Not used. Open is an in-app list of the app folder, like OneDrive.                                                                                                                                                                                                   |

## What's in the app

All of it lives under one **File** menu in the top bar (budget: about 7 top-bar controls, 12 items per menu
level). The canvas right-click menu has the same actions. The top bar is: view tabs, diagram picker,
**View** (node and edge style; it replaced the two selects), **File**, **Present** and theme. Below 1100px,
View, File and Present become icon-only, so the bar fits at 1024px without scrolling.

| File menu                    | Notes                                                                                                                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Save** (Ctrl+S)            | Goes back to wherever the diagram came from or was last saved: the same device file (File System Access) or the same file in Google Drive, OneDrive or Dropbox. Otherwise it asks where to save (or downloads, in browsers without the API). Ctrl+Shift+S is "Save as". |
| **Open…** (Ctrl+O)           | `.diagram.json`, `.drawio`, `.xml`, `.drawio.svg`, `.mmd`, and docker-compose `.yml` / `.yaml`, several files at once. A draw.io file with several pages asks which page to open.                                                                                       |
| Open from ▸ / Save to ▸      | Only when at least one cloud provider is configured (see "Storage providers" below); otherwise hidden completely, and **Save as…** stays a plain row. Each lists **This device** first, then the configured providers. Save to ▸ always makes a new file.               |
| **Export PNG**               | 2×, whole diagram, independent of pan and zoom.                                                                                                                                                                                                                         |
| **Copy share link**          | One click; the toast's **Details** opens the dialog (length, warning above 8k characters, native Share).                                                                                                                                                                |
| **Copy link with password…** | Encrypts the diagram into a `#e=` link with a password (8+ characters, strength hint); see "Share links and embeds" below.                                                                                                                                              |
| More formats ▸               | Diagram file (`.diagram.json`, lossless, simulations included) · Image… (PNG or SVG; scale and transparent background behind **Options**) · draw.io · Copy as Mermaid · Mermaid file (`.mmd`) · Embed code… · Save as…                                                  |
| Import from ▸                | Paste text… (JSON, draw.io XML, Mermaid or docker-compose, auto-detected) · Share link…                                                                                                                                                                                 |

You can also drop files anywhere on the page to open them (several at once: a compose file with its overrides).

**Where imports go.** Files open into the single "Imported" slot (examples are never overwritten).
Share links open into a separate **Shared** slot, so a link someone sends you never replaces your own
work. A "Shared · Save a copy" chip in the top bar moves it into the Imported slot.

**Toasts.** `notify(text, { kind, action })` from `src/interop/ui/toast.tsx` works from anywhere
(components, `canvasBridge`). It shows one toast at a time, with an optional action button (for example
"Undo"). `toast.busy()` / `toast.dismiss(id)` report progress.

**New diagrams.** `createDiagram(seed)` in `src/lib/diagramIO.ts` stores a new diagram and fires
`diagrams:changed`. The App re-reads its slots (also on the `storage` event from other tabs), so no
reload is needed.

### Native format robustness (`src/interop/native.ts`)

- Versioned validation with messages that point at the problem, for example `Node #3 ("orders") doesn't`,
  `Edge "e7" points at a node that isn't in the file ("ghost")`, or "newer than this version, reload".
- Gentle repairs with warnings: malformed groups are dropped, dangling group references cleared, bad enum
  values removed, and duplicate edge ids renamed.
- `migrate(raw)` chains the steps registered in `MIGRATIONS` (keyed by source format) up to `diagrams/v1`.
- Unknown fields are kept. The canvas only carries known fields, so every export re-attaches unknown
  top-level, node, edge and group fields from the original file (`preserveUnknown`).
- **One validator** (`validateDiagram`) for every way in: file open, drag-and-drop, paste, share links, Google
  Drive, draw.io, Mermaid and docker-compose converter output, and storage reads (`getImported` / `getShared` / `getAutosave`).
  Writes are validated too: `setImported` / `setShared` throw a readable error _before_ replacing a slot, so a bad
  file can't overwrite good work or crash the canvas. It checks every field the UI renders: string ids, stencils
  and labels; finite coordinates; edges pointing at real nodes; groups with finite, non-negative geometry; side
  kind and relationship enums; well-formed `props.settings` on edges; and simulation shape (traffic, timeline, expectations). Malformed simulations are skipped with
  a reason.
- **Budgets for untrusted input** (`LIMITS`): 8 MB of text (files are checked by `File.size` before reading),
  48 levels of nesting (iterative walk), 5,000 nodes / 20,000 edges / 1,000 groups / 200 simulations /
  2,000 annotations, and compressed payloads (share links, draw.io pages) that stop inflating at the cap
  (zip-bomb guard). An annotation's text is cut at 10,000 characters and its width or height must be
  1–20,000 px. A malformed annotation is skipped with a reason, as is an edge that ends on a text, note or
  zone (only shapes take edges).
- Storage failures never crash anything: autosave writes return `false`, and the user gets one toast that says to
  export. Imports report "storage is full or blocked" and keep the previous copy.

### Infrastructure imports: docker-compose (`src/interop/infra/`)

Batch 1 of the plan in `docs/research/imports.md` (which has the full mapping tables). Everything is read in the tab.

- **One pipeline.** `sniff.ts` (in the entry, a few regexes on the first 4,000 characters) recognises compose,
  Kubernetes, AsyncAPI, Terraform JSON and Helm templates. Compose goes to the lazy `infra/pipeline.ts` chunk with
  the `yaml` package: reader (`compose.ts`) → `ImportGraph` (`graph.ts`: components, links with their
  evidence, groups, report lines) → stencils and relationships (`map.ts`, `stencils.ts`) → the three-step layout
  (`layout.ts`) → `validateDiagram`. The other recognised formats get "isn't supported yet" from the same chunk.
- **Several files.** Open… (`multiple`), a drop and the file input take every file. Files are grouped by format and
  the largest group imports: compose files merge the way Compose merges (base first, then `*.override.yml`);
  `.env` files beside them feed `env_file`. A group of diagram, draw.io or Mermaid files opens the first and says
  so. 8 MB for all files together (by `File.size`, before reading), 100 files, 2,000 YAML documents.
- **Stencils.** `resolveStencil`: the image table (any registry, tag ignored), then settings that name a language,
  then the catalogue by name (`namedStencil`), then Service. A framework's own prefix (`SPRING_`, `ASPNETCORE_`,
  `DJANGO_`) is sure; `NODE_ENV`, `JAVA_OPTS` and `DOTNET_` are guesses, and so is anything named only by the
  catalogue. A name ending in a role word ("payments-worker") is a Service, not a guess.
- **Connections from settings** (`settings.ts`): URLs and `*_HOST`/`*_URL`/… values that name another service,
  Kafka brokers, `*_TOPIC(S)` (read, written or a guess, with the consumer group), `*_FILE=/run/secrets/…`, and
  known outside hosts (Key Vault, Service Bus, Stripe…). A broker with no topic named gets **Depends on**. A flow
  wins over `depends_on` for the same pair, including a flow through one of the cluster's topics. **Values are read
  in memory only**: what reaches the diagram or the report is names (services, topics, variables, secrets) and the
  host names of outside services. URL userinfo is cut first, values over 2,048 characters are skipped, every
  pattern is linear, and interpolation uses the file's own `${VAR:-default}` only.
- **Boundaries** are the networks when they divide the services (two or more, and 80% of services on exactly one);
  a service on several goes where most of its connections are, and the report says so.
- **The Import report** (`ui/ImportReportDialog.tsx`, lazy) opens from the toast's **Details** ("Imported “shop”
  from docker-compose: 15 nodes, 17 connections. 2 guesses.", 7 s when there's something to check) and from Ctrl+K
  "Import report" while that diagram stays open. Sections: guesses with stencil chips (one undo step each, through
  the AI panel's `swapStencil`) and **Other…** (a catalogue search); connections found in settings with the
  variable; not drawn, with a fixed reason; couldn't read. A name selects its node. The report is kept in memory
  (`useInterop`), never in the file, a share link or an export.
- **Privacy.** An import is opened like any file from this device, so **New diagrams are private** applies. The
  report's foot says "Read on this device. Nothing was uploaded." and, when the diagram isn't private, offers
  **Make it private**.
- **Security.** `yaml` with `maxAliasCount: 100` (it counts expansion: the alias bomb fails in milliseconds),
  merge keys on, the core schema with no custom tags, unique keys; then an iterative walk with the validator's
  depth limit (48) and a 200,000-value budget. Parsed maps are read with `Object.hasOwn` and merged into
  prototype-free objects. Nothing is fetched (`include`, remote `env_file` and `extends` files are listed as not
  read), nothing is evaluated, and the CSP is unchanged.
- **Tests.** `infra/*.test.ts` (the fixture end to end, Compose features, settings, the hostile fixtures, ReDoS,
  no values in the output), `tests/e2e/imports.spec.ts`, the CSP walk, the bundle-split guard
  (`src/interop/infra/`, `yaml` and the report are never startup JavaScript) and the Lab's "Imported: compose"
  overlap audit. The sniffers and the wiring add 0.8 kB gzip to the entry.
- **Copy for this batch.** The drop overlay lists `docker-compose.yml`, the paste dialog names docker-compose, and
  the start card has one line, "Have a docker-compose file? Drop it here." The plan's wider wording (Kubernetes,
  AsyncAPI, Terraform) waits for the batches that import them.

### draw.io (`src/interop/drawio/`)

- **Import.** Handles compressed and plain pages, multiple pages, `.drawio.svg`, and object wrappers.
  Shape styles and image paths map to stencils through the mapping table. Generic shapes (cylinder, actor)
  yield to label keywords ("Postgres", "Kafka", "Service Bus": `src/interop/infer.ts`), and the fallback is
  `generic.service`. Swimlanes, `container=1`, AWS groups and any vertex with children become boundaries,
  with the tone taken from style or label. Edges keep their labels (including edge-label children):
  dashed means async, solid means sync. Dangling connectors are skipped, with a warning. Geometry is
  preserved; foreign files are spread out to fit our 220×72 cards, and boundaries grow to contain them.
- **Annotations.** Free-standing text cells become **text** and `shape=note` becomes a **note**. A rhombus
  is always a **shape** (diamond). A plain rectangle, rounded rectangle, ellipse or cylinder becomes a
  shape when nothing connects to it and its label names no product; connected or named ones stay nodes,
  so the simulation keeps them. Our own export writes each annotation with `dg_annotation`, `dg_shape`,
  `dg_color` and `dg_text_size`, so it reads back exactly. On export, zones are dashed rounded rectangles
  written first (behind everything), and edges may end on shapes.
- **Export.** Uncompressed `.drawio`. Uses built-in Azure / AWS / Kubernetes shapes where mapped, and
  otherwise our icon as a data-URI image. Boundaries are containers (members are children). Edges are
  orthogonal, dashed for async, with labels and pinned sides. Our ids, stencils, props, description,
  direction and simulations ride along as `<object>` properties (`dg_*`), so importing our own export is
  lossless (unit-tested on every public example).
- **Relationships.** A dependency exports as a thin dotted connector (`dashed=1;dashPattern=1 4`) with an open
  arrowhead, stroked in its light-theme tint, plus `dg_relation` and a `dfRelation=<relation>` style key. Import
  reads either, so the relation survives even if draw.io drops our custom data; its saved kind comes back too.

### Mermaid (`src/interop/mermaid/`)

- **Export.** `flowchart LR|TB` with front-matter title, subgraphs, `-.->` for async and `-->` for sync,
  quoted labels (`label<br/>sublabel`), cylinders for data stores and stadiums for clients. A trailing
  `%% diagrams:{…}` comment keeps ids, stencils and tones; Mermaid ignores it. Shape annotations become
  Mermaid nodes of the same shape (`[]` `()` `(())` `{}` `[()]`) and keep their edges; text, notes and
  zones have no Mermaid equivalent and are left out.
- **Import.** The syntax above. Positions come from the editor's layered auto-layout (`src/editor/layout.ts`),
  with subgraph members kept adjacent in each layer and boundaries fitted around them. Stencils come from
  the metadata comment, then label keywords, then shape (a cylinder means a store).
- **Relationships.** A dependency exports as a dotted link whose label starts with its implicit words:
  `-.->|"reads secrets"|`, or `-.->|"reads secrets: Key Vault Secrets User"|` with a user label, and gets a
  fine dotted, tinted `linkStyle`. The metadata comment records each one (and a sync kind), so our own export
  round-trips exactly. Without metadata, a dotted link whose label starts with an implicit label or a
  relation word (`secret:`) becomes that dependency; any other dotted link stays an async message, as before.

### Share links and embeds (`src/interop/share.ts`, `src/interop/embed/`)

- `#d=<base64url(deflate-raw(JSON))>` lives in the URL _fragment_, which browsers never send to the server.
  So it never reaches server logs. A full example with two simulations is about 3k characters. The dialog
  warns above 8k.
- `#e=v1.<salt>.<iv>.<ciphertext>` (`src/interop/passwordLink.ts`, WebCrypto in `shareCrypto.ts`, loaded on use) is a **password link**: the same compressed
  bytes, encrypted with AES-256-GCM (random 12-byte IV, additional data `livediagrams:e:v1`) under a key from
  PBKDF2-HMAC-SHA-256 (600,000 iterations, OWASP's recommendation; random 16-byte salt) of the NFC-normalized
  password. The version picks every parameter, so a later version can raise the count and old links still open.
  Opening one asks for the password (`password-prompt`); a GCM authentication failure reads as a wrong password
  and the prompt stays for another try. The fragment is cleared once the link is decrypted (not before, so
  Cancel and a reload ask again). Plain `#d=` links were already cleared on open: the diagram stays in the
  Shared slot, so a reload still shows it. Embeds (`?embed=1#e=…`) ask inside the frame and keep the fragment.
- Every link (share, password, inline embed, the agents' `get_share_link`) asks `canShareAsLink(state)` in
  `src/lib/localOnly.ts` first, and again at the moment it acts (after encrypting, before copying): a local-only or
  Private diagram gets no link, and a password-link dialog left open closes when its diagram turns private.
- `?embed=1&example=<slug>` (public examples only), `?embed=1#d=…` or `?embed=1#e=…` renders a read-only viewer: no top bar,
  fitted, pan and pinch-zoom only (the wheel scrolls the host page), no menus, shortcuts or autosave, and a
  subtle "Open in Diagrams" link. `live=1&sim=<id>` pass through for the live view.
- The embed dialog previews the iframe, and its options (source, height, simulation) sit behind **Options**.

### Security headers (`scripts/security-headers.ts`)

One source for the Content-Security-Policy and the other headers. `pnpm schemas` writes `vercel.json` from it
(`src/lib/securityHeaders.test.ts` fails when it's stale) and `vite preview` sends the same headers, so the e2e
suite on a build (CI's default) runs under the real policy; `tests/e2e/csp.spec.ts` walks the app and fails on any
violation. The dev server sends none (React Refresh's preamble is an inline script).

- `script-src 'self'` plus Google's two loaders (Identity Services, the Picker's `api.js`). No `'unsafe-inline'`,
  no `'unsafe-eval'`: the static pages' scripts are files (`public/theme.js`, `auth.js`, `skill/copy.js`).
- `style-src 'self' 'unsafe-inline'`: the static pages' `<style>` blocks and the styles Google's Picker and
  Identity Services add. React's `style` props don't need it (they go through the CSSOM).
- `connect-src 'self'` plus exactly the providers' endpoints: Google (`accounts.google.com/gsi/`,
  `www.googleapis.com`, `oauth2.googleapis.com`), Microsoft (`login.microsoftonline.com`, `graph.microsoft.com` and
  the download hosts `*.1drv.com`, `*.microsoftpersonalcontent.com`, `*.sharepoint.com`) and Dropbox
  (`api.dropboxapi.com`, `content.dropboxapi.com`). No `data:`: exports decode their data URLs without fetch.
- `frame-ancestors *` only for `?embed=1` (Vercel routes on the query with `has`/`missing`); the app itself
  allows only this site to frame it.
- `Referrer-Policy: strict-origin-when-cross-origin` (other sites see only the origin; a referrer-restricted
  Google API key still works), `X-Content-Type-Options: nosniff`, a `Permissions-Policy` that keeps the
  microphone (dictation) and display capture (Record video) and turns off location, payment, USB and serial (only
  features every desktop Chromium recognises: an unknown one logs "Unrecognized feature" on every page), and `Cross-Origin-Opener-Policy: same-origin-allow-popups` (sign-in pop-ups keep their opener; not sent with
  `auth.html`).

### Local folders: Google Drive for desktop, OneDrive, Dropbox (no setup)

In Chrome or Edge, **Save** uses the File System Access API. Saving into a folder that Google Drive for desktop,
OneDrive or Dropbox syncs puts the diagram in the cloud with no OAuth at all, and Ctrl+S keeps writing to
that same file. After a reload, the browser asks once to allow editing again. In Firefox and Safari, Save
downloads the file and Open uses the standard file picker.

## Storage providers

Every way a file is opened or saved goes through one interface, `StorageProvider` in
`src/interop/storage/types.ts`: `id`, `label`, `icon`, `isConfigured()`, `signIn()` / `signOut()`, `open()` (a
picker or the in-app list, returning `{ name, text, ref }`), `save(ref, text)` (same file), `saveAs(name, text)`
(a new file, returning its `ref`) and an optional `list()`.

| Provider     | Enabled by                                      | Open                              | Save goes to                                | Code                                      |
| ------------ | ----------------------------------------------- | --------------------------------- | ------------------------------------------- | ----------------------------------------- |
| This device  | always                                          | system file picker (or `<input>`) | the same file (Chrome, Edge), or a download | `storage/device.ts`, `files.ts`           |
| Google Drive | `VITE_GOOGLE_CLIENT_ID` + `VITE_GOOGLE_API_KEY` | Google Picker                     | `drive.file` files in My Drive              | `storage/gdrive.ts`, `gdrive/*`           |
| OneDrive     | `VITE_ONEDRIVE_CLIENT_ID`                       | in-app list of Apps › Diagrams    | Apps › Diagrams                             | `storage/onedrive.ts`, `storage/oauth.ts` |
| Dropbox      | `VITE_DROPBOX_APP_KEY`                          | in-app list of Apps › Diagrams    | Apps › Diagrams                             | `storage/dropbox.ts`, `storage/oauth.ts`  |

- **Optional and lazy.** `storage/registry.ts` (in the main bundle) holds only names, icons and env flags. Each
  cloud provider is its own chunk, loaded when the File menu opens or the provider is used, and only if it's
  configured. A malformed value (a client id that isn't a GUID, say) hides the provider instead of failing later.
- **Save destinations.** A diagram's destination is `{ providerId, ref, name, savedAt }`, published in the same
  storage write as the document (`src/lib/diagramIO.ts`), so a diagram and where it saves can never drift apart.
  Device refs are file handles and stay in memory; every other `ref` is JSON (`{ id }`). Destinations written
  before providers existed (`drive: { id, name }`) are still read as Google Drive.
- **Sign-in (OneDrive, Dropbox).** Auth code flow with PKCE in a popup (the open diagram is untouched), returning
  to `auth.html`. The popup opens inside the click, before anything is awaited, so blockers allow it. Tokens live
  in the tab's memory only: a reload signs you out. OneDrive renews silently for 24 hours with its SPA refresh
  token; Dropbox tokens last about 4 hours, then the next action signs in again (no prompt for a returning user).
  The file list's footer has **Sign out of …**.
- **Status.** Beside the diagram picker: "Saved to OneDrive · 2 min ago" (or "Opened from Dropbox"); its tooltip
  names the file. It's text, not a control, and hides below 1100px.
- **Tests.** Each REST client and the OAuth helpers are unit-tested against a fake `fetch`. End-to-end tests use
  **Test storage**, a fake provider that keeps files in localStorage: it exists only in dev builds and only with
  `?storage=test` in the URL (`tests/e2e/storage.spec.ts`). The production build drops it, and
  `tests/e2e/subpath.spec.ts` checks that the production build offers and contacts no provider.

### Owner setup: putting a value in the Vercel build

Vite bakes `VITE_*` variables into the static JS at build time, so a variable only takes effect in a new build.
None of these values are secrets (OAuth client ids and app keys are public for PKCE apps; the Google API key is
locked to the Picker API and your referrers). Never add a client secret or app secret anywhere.

1. Open the Vercel dashboard → the **diagrams** project → **Settings** → **Environment Variables**.
2. **Add New**: the key (for example `VITE_ONEDRIVE_CLIENT_ID`) and its value. Tick **Production** and
   **Preview** (and **Development** if you use `vercel dev`). **Save**.
3. Go to **Deployments**, open the latest production deployment's **⋯** menu → **Redeploy** (environment
   variables apply only to new builds).
4. Local dev: copy `.env.example` to `.env.local` (git-ignored), fill in the same values, restart `pnpm dev`.

To remove a provider, delete its variable and redeploy; its menu entries disappear.

### App name, logo and policy pages (all providers)

The app's name is **Live Diagrams**, with a space, everywhere users see it: the top bar, the start card's footer,
`index.html` (`<title>`, description, Open Graph and the static start-up page), the privacy policy and terms, and
every consent screen. Google compares the consent screen's name with the home page's and rejects a mismatch (it
rejected "LiveDiagrams" once), so enter it exactly. Code identifiers, storage keys, the `diagrams/v1` format, the
`.diagram.json` extension and the repo name stay "diagrams"; so does the providers' folder, **Apps › Diagrams**
(see OneDrive and Dropbox below).

| What                     | Value                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App name                 | `Live Diagrams`                                                                                                                                                           |
| Home page                | `https://www.livediagrams.dev` (the bare domain redirects there with a 308)                                                                                               |
| Privacy policy           | `https://www.livediagrams.dev/privacy.html` (`public/privacy.html`)                                                                                                       |
| Terms of service         | `https://www.livediagrams.dev/terms.html` (`public/terms.html`)                                                                                                           |
| Authorized domain        | `livediagrams.dev`                                                                                                                                                        |
| Support and contact mail | `latch.kostov@gmail.com` (also the privacy policy's contact)                                                                                                              |
| Logo files               | `public/brand/logo-120.png` (Google), `logo-215.png` (Microsoft), `logo-64.png` and `logo-256.png` (Dropbox), all rendered from `public/favicon.svg`, the site's own icon |

What reviewers look for, and where it is: without signing in, the home page shows the name (top bar), what the
app does (the start card's footer, `start-about`) and **Privacy** and **Terms** links beside it. A crawler that
doesn't run JavaScript gets the same from `index.html`'s static start-up page, which React replaces on load. The
privacy policy has a section per provider (scope, use, where data goes, tokens, no sharing, how to revoke and
delete), Google's Limited Use disclosure and a contact address. `tests/e2e/brand.spec.ts` checks that the names
match exactly and that the links and the disclosure are there.

### Google Drive (owner, one time)

1. **Create a project.** Go to <https://console.cloud.google.com/>, then project picker → **New project**. Name it
   (e.g. `diagrams`) → **Create**, and select it. On the dashboard, note the **Project number** (digits, not the
   project id).
2. **Enable the APIs.** **APIs & Services → Library**: enable **Google Drive API** and **Google Picker API**.
3. **Set up the consent screen.** **Google Auth Platform** (older consoles: **APIs & Services → OAuth consent screen**):
   - **Branding**: the values in "App name, logo and policy pages" above (field by field in "Before strangers can
     use it" below).
   - **Audience**: **External**, publishing status **Testing**. Add your own Google account (and anyone else who
     should try it) as a test user. In Testing only they can sign in, and each consent expires after 7 days.
   - **Data access**: **Add or remove scopes** → `https://www.googleapis.com/auth/drive.file` ("See, edit, create,
     and delete only the specific Google Drive files you use with this app") → **Update** → **Save**.
4. **Create the OAuth client ID.** **Clients** (or **Credentials → Create credentials → OAuth client ID**):
   - Application type **Web application**, name `Diagrams web`.
   - **Authorized JavaScript origins** (no paths, no trailing slash): `https://www.livediagrams.dev`,
     `https://livediagrams.dev` (if the bare domain serves the app rather than redirecting), `http://localhost:5173`
     (plus any other dev port you use), and any Vercel preview domain you want Drive on.
   - Leave **Authorized redirect URIs** empty (Google's token model uses its own popup).
   - **Create**, then copy the **Client ID** (`123456789012-….apps.googleusercontent.com`). There's no secret to keep.
5. **Create an API key.** **APIs & Services → Credentials → Create credentials → API key**, then edit it:
   - **Application restrictions: Websites**: `https://www.livediagrams.dev/*`, `https://livediagrams.dev/*`,
     `http://localhost:5173/*` and **`https://docs.google.com/*`** (the Picker iframe calls from there; without it:
     "The API developer key is invalid").
   - **API restrictions: Restrict key** → only **Google Picker API**. Save, then copy the key.
6. **Add to Vercel** (steps above): `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`, and optionally
   `VITE_GOOGLE_APP_ID` (the project number; it defaults to the client id's numeric prefix). Redeploy.
7. **Try it.** On livediagrams.dev: **File → Save to ▸ Google Drive** (a Google popup asks for consent once), then
   **File → Open from ▸ Google Drive**. Files are `*.diagram.json` in My Drive; **Save** (Ctrl+S) updates the same
   file.

**Before strangers can use it.** In Testing, only test users can sign in. Publishing lets anyone with a Google
account in. `drive.file` is a _non-sensitive_ scope (Google's Drive scope table), so there's no security
assessment and no demo video. Google's "unverified app" screen and its 100-user cap apply to sensitive and
restricted scopes. What remains is **brand verification**: until it's done, the consent screen shows only the
domain, not the name and logo. Rules checked in October 2026 against Google's "Submit for brand verification",
"Verification requirements" and "Manage app branding" pages. In order:

1. **Verify the domain in Search Console.** Sign in with a Google account that is an **Owner** or **Editor** on the
   Cloud project. Go to <https://search.google.com/search-console> → **Add property** → **Domain** →
   `livediagrams.dev`. A Domain property covers `www` and the bare domain; Google wants the top private domain.
   Copy the `google-site-verification=…` value. In Porkbun, open **Domain Management** → `livediagrams.dev` →
   **DNS** → add a record: type **TXT**, host empty (the apex), answer = that value, TTL 600. Back in Search
   Console, click **Verify**. DNS can take a few minutes to an hour. Keep the record: deleting it un-verifies the
   domain.
2. **Branding** (Google Auth Platform → **Branding**). Enter these exactly. They save as draft branding:
   - **App name**: `Live Diagrams`. It must match the name on the home page. Don't use "Google" or "Drive" in it.
   - **User support email**: `latch.kostov@gmail.com`. It must be your own account or a Google Group you manage.
   - **App logo**: upload `public/brand/logo-120.png`. Google wants a square image, 120 × 120 px for the best
     display, in JPG, PNG or BMP, up to 1 MB, that actually represents the app. It's the site's own icon (the
     favicon and the start-up page's mark).
   - **Application home page**: `https://www.livediagrams.dev`.
   - **Application privacy policy link**: `https://www.livediagrams.dev/privacy.html`. This must be the same URL
     the home page links to.
   - **Application terms of service link**: `https://www.livediagrams.dev/terms.html`.
   - **Authorized domains**: `livediagrams.dev`. It must cover every URL above and the client's JavaScript origins.
   - **Developer contact information**: `latch.kostov@gmail.com`. Google's Trust & Safety team writes here, and
     missing their mail can cost API access.
3. **Data access**: only `…/auth/drive.file`, listed under non-sensitive scopes. Remove anything else.
4. **Audience → Publish app** (Testing → In production) → **Confirm**.
5. **Verify Branding** (Branding page). The automated check usually takes a few minutes. It ends as either:
   - **Ready to publish**: go on to the next step.
   - **Need to fix issues**: **View issues** lists what failed. Fix it and verify again.

   If a finding looks wrong, for example it missed the Privacy link, choose **request additional review**. That
   opens the Verification Center: click **Confirm**. A manual review usually takes 2–3 business days, and Google
   may email the developer contact. You can't edit branding while a check runs (**Cancel** it first).

6. **Publish branding** within 7 days of **Ready to publish**. After 7 days it says **Need to re-verify**.
7. **Check it.** In a private window, sign in with an account that isn't a test user. Choose **File → Save to ▸
   Google Drive**. The consent screen should say "Live Diagrams", show the logo, and ask only to "See, edit,
   create, and delete only the specific Google Drive files you use with this app".

Later, any change to the name, logo or links needs another **Verify Branding**. A change to the app's use of Drive
data needs the privacy policy updated first, with a new effective date.

**Troubleshooting.** A blocked popup: allow pop-ups for the site. `origin_mismatch`: the page's origin isn't in the
client's JavaScript origins. "API developer key is invalid": a referrer is missing from the key, often
`https://docs.google.com/*`. A 403 on open: the file wasn't picked through the Picker, or `appId` isn't the project
number.

### OneDrive (owner, one time)

You need a Microsoft Entra tenant to register the app (a bare personal Microsoft account can no longer own app
registrations). If you don't have one, sign up for a free Azure account with your Microsoft account; that creates
a "Default Directory" tenant. The app still works with everyone's personal and work OneDrive.

1. Go to <https://entra.microsoft.com> → **Entra ID** (or **Identity**) → **App registrations** → **New registration**.
   - **Name**: `Diagrams`. Users see this name when they consent. OneDrive also names the app folder after the
     registration (**Apps › Diagrams**), and the app's label for that folder is hard-coded (`folder` in
     `storage/onedrive.ts`). See "The name on Microsoft's consent screen" below before you change it.
   - **Supported account types**: **Accounts in any organizational directory (Any Microsoft Entra ID tenant -
     Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)**.
   - **Redirect URI**: platform **Single-page application (SPA)**, URI `https://www.livediagrams.dev/auth.html`.
   - **Register**.
2. **Authentication** → under **Single-page application** → **Add URI**: `http://localhost:5173/auth.html` (Entra
   ignores the port for `localhost`, so any dev port works) and, if the bare domain serves the app,
   `https://livediagrams.dev/auth.html`. Leave both **Implicit grant** boxes unticked and **Allow public client
   flows** at **No**. **Save**. It must be the SPA platform, not "Web": only SPA redirect URIs let the browser
   redeem the code ("Web" fails with `AADSTS9002326`).
3. **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions** → tick
   **Files.ReadWrite.AppFolder** and, under OpenId permissions, **offline_access** → **Add permissions**. You can
   remove the default **User.Read**; Diagrams doesn't use it. Don't grant admin consent: users consent for themselves.
4. **Branding & properties**:
   - **Logo**: `public/brand/logo-215.png`. The portal states its size limit beside the upload.
   - **Home page URL**: `https://www.livediagrams.dev`.
   - **Terms of service URL**: `https://www.livediagrams.dev/terms.html`.
   - **Privacy statement URL**: `https://www.livediagrams.dev/privacy.html`.

   **Save**.

5. **Overview** → copy the **Application (client) ID** (a GUID). There's no secret: don't create one under
   **Certificates & secrets**.
6. **Add to Vercel** (steps above): `VITE_ONEDRIVE_CLIENT_ID` = that GUID. Optional `VITE_ONEDRIVE_TENANT`:
   `common` (the default: personal and work accounts), `consumers` (personal only) or `organizations` (work only).
   Redeploy.
7. **Try it.** **File → Save to ▸ OneDrive**: a Microsoft popup signs you in and asks for consent once. The file
   appears in OneDrive under **Apps › Diagrams**. **File → Open from ▸ OneDrive** lists that folder.

**Before strangers can use it.** No review is needed:

- **Personal Microsoft accounts** can sign in now. The consent screen shows the app as from an "unverified"
  publisher.
- **Work or school tenants** often block users from consenting to unverified multitenant apps (Microsoft's
  risk-based step-up consent, for apps registered after November 2020). Those users see "Need admin approval"
  until their admin consents, or until you finish **publisher verification**, which adds a blue "verified" badge.

Publisher verification is free, but it verifies a **business**. Rules checked in October 2026 against Microsoft
Learn's "Publisher verification overview", "Mark an app as publisher verified" and Partner Center's "Understand
the verification process":

1. **Partner Center account.** Enroll in the Microsoft AI Cloud Partner Program at
   <https://partner.microsoft.com/dashboard>. Microsoft checks:
   - the primary contact's **business email** (not a free address such as Gmail; an address at `livediagrams.dev`,
     for example through Porkbun's email forwarding, can receive the code);
   - a **government ID**;
   - **domain documents** from the registrar (Porkbun's registration details for `livediagrams.dev`);
   - the business's **legal registration**.

   It usually takes 3–5 business days. A person without a registered business can't pass the business check
   today, so leave this until there is one. Note the **Partner One ID** of the partner global account (PGA), not a
   location ID.

2. **A work account, not a personal one.** Microsoft can't verify an app registered with a personal Microsoft
   account. If the tenant came from signing up with your personal account, create a user in it (Entra ID →
   **Users** → **New user**). Give it **Application Administrator** (or Cloud Application Administrator) and MFA,
   and add it as an owner of the app registration.
3. **Verify the domain in the tenant.** Entra ID → **Domain names** → **Add custom domain** → `livediagrams.dev`.
   Add the `MS=ms…` **TXT** record in Porkbun DNS (host empty, the apex), then **Verify**. Then in the app's
   **Branding & properties**, set **Publisher domain** to `livediagrams.dev`. It can't be `*.onmicrosoft.com`. The
   Partner Center email's domain must match it.
4. **Add the Partner ID.** Sign in to <https://entra.microsoft.com> with MFA as a user who is an Application
   Administrator in Entra and an Account Admin (or Partner Admin) in Partner Center. Open the app →
   **Branding & properties** → **Add Partner ID to verify publisher** → enter the Partner One ID → **Verify and
   save**. It takes minutes.
5. **Check it.** Sign in with a work account, adding `prompt=consent` by hand while testing. The consent screen
   shows the blue badge.

Microsoft's app-folder guide says `Files.ReadWrite.AppFolder` works for work or school OneDrive, but the permissions
reference still lists it as personal only. Try it with a work account before announcing work support.

**The name on Microsoft's consent screen.** It's the registration's **Name**, `Diagrams`, while the site says
"Live Diagrams". Microsoft doesn't compare it with the site the way Google does. OneDrive creates each user's
**Apps › <name>** folder the first time it's used, and Diagrams always finds it through `special/approot`, so
access never depends on the name. To make the consent screen say `Live Diagrams`, rename the registration
(**Branding & properties → Name**). Then:

- New users' folder will be called **Apps › Live Diagrams**.
- Change the folder label in `storage/onedrive.ts` and the **Apps › Diagrams** wording in the UX vocabulary and
  the privacy policy in the same change.
- Before announcing it, check with an existing user whether OneDrive renames their folder (Microsoft doesn't
  document this).

Until then, keep the name `Diagrams`, so the label matches every user's folder.

**Troubleshooting.** `AADSTS50011` (redirect URI mismatch) in the popup: that exact `…/auth.html` URI isn't
registered. `AADSTS9002326`: the redirect URI is under "Web", not "Single-page application". "Need admin approval":
see publisher verification above. A 403 from Graph: the file isn't in Apps › Diagrams (the app can't see anything
else).

### Dropbox (owner, one time)

1. Go to <https://www.dropbox.com/developers/apps> → **Create app**.
   - **Choose an API**: **Scoped access**.
   - **Choose the type of access**: **App folder** (Diagrams then sees only its own folder).
   - **Name**: what users see when they allow access, and unique across Dropbox. Use `Live Diagrams` if it's free,
     or else something that includes it. Dropbox's branding guide forbids names that start with "drop", contain
     "Dropbox", or sound like it. **Create app**.
2. **Settings** tab:
   - **App folder name**: `Diagrams` (the folder becomes **Apps › Diagrams** in users' Dropbox). This is
     separate from the app name, so the app can be called "Live Diagrams" while the folder stays as it is. Leave
     it, because the app's label for it is hard-coded (`folder` in `storage/dropbox.ts`).
   - **OAuth 2 → Redirect URIs**: add `https://www.livediagrams.dev/auth.html` and `http://localhost:5173/auth.html`
     (Dropbox matches exactly, port included; add each dev port, and the bare domain if it serves the app).
   - **Allow public clients (Implicit Grant & PKCE)**: **Allow**.
   - Copy the **App key**. Never use or share the **App secret**; Diagrams doesn't need it.
3. **Permissions** tab: tick **files.metadata.read**, **files.content.read** and **files.content.write** →
   **Submit**. Set these before anyone links: users who linked earlier must approve again after a scope change.
4. **Branding** tab:
   - **Icons**: `public/brand/logo-64.png` and `logo-256.png`. They must look like the app's logo elsewhere and
     must not resemble Dropbox's.
   - **Description**: one line, for example "Draw distributed systems, then watch messages flow through them.
     Saves your diagrams to its own Dropbox folder."
   - **Website**: `https://www.livediagrams.dev`.
   - **Privacy policy**: `https://www.livediagrams.dev/privacy.html`.
5. **Add to Vercel** (steps above): `VITE_DROPBOX_APP_KEY` = the app key. Redeploy.
6. **Try it.** **File → Save to ▸ Dropbox**: a Dropbox popup asks to allow access once. The file appears in
   **Apps › Diagrams**. **File → Open from ▸ Dropbox** lists that folder.

**Before strangers can use it.** Rules checked in October 2026 against Dropbox's developer guide and branding
guide. A new app is in **Development** status and links only your own account at first:

1. **Settings → Development users → Enable additional users.** Now anyone can link it, up to 500 users.
2. **Get ready for review.** Dropbox rejects apps that break its branding guide or terms. Check that:
   - the Branding tab is complete (above);
   - the app names Dropbox only to identify the integration ("Save to ▸ Dropbox", "Sign out of Dropbox"), never
     its logo as the app's own;
   - the privacy policy is specific to the app (`privacy.html`'s Dropbox section);
   - the scopes are no broader than needed (app folder plus the three file scopes; nothing else).
3. **Settings → Production status → Apply for production.** You can apply any time, but Dropbox reviews only
   after **50 users** have linked the app, unless you give a compelling reason to review earlier. Once 50 have
   linked, you have **two weeks** to get approval, or new users can't link until you do. The form asks how the
   app uses the API. For example: "Live Diagrams is a browser-only diagram editor. Users save diagrams as
   .diagram.json files into the app's own folder (App folder access) and open them again later. There is no
   server: the browser calls the Dropbox API directly with short-lived PKCE tokens kept only in the tab's memory."
   Dropbox answers most requests within a few business days.

**Troubleshooting.** "Invalid redirect_uri" in the popup: that exact `…/auth.html` URI (with its port) isn't
listed. "Invalid client_id": wrong app key. `missing_scope`: tick the scopes under **Permissions**, then sign in
again.

## Files

| Path                                                       | Purpose                                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/interop/native.ts`                                    | Validation, `migrate`, `preserveUnknown`, `serializeNative`                                         |
| `src/interop/formats.ts`                                   | Format detection, `importText` (one entry point for every import)                                   |
| `src/interop/codec.ts`, `xml.ts`                           | DEFLATE / base64url codecs; a dependency-free XML reader (Node has no DOMParser)                    |
| `src/interop/infer.ts`                                     | Label keywords → stencil                                                                            |
| `src/interop/infra/*`                                      | Infrastructure imports: YAML, the compose reader, stencils, settings, mapping, layout (lazy)        |
| `src/interop/ui/ImportReportDialog.tsx`                    | The Import report (lazy)                                                                            |
| `src/interop/drawio/{read,write,mapping}.ts`               | draw.io converter plus fixtures in `drawio/fixtures/`                                               |
| `src/interop/mermaid/{read,write}.ts`                      | Mermaid converter                                                                                   |
| `src/interop/share.ts`                                     | Share-link and embed URL helpers                                                                    |
| `src/interop/gdrive/{config,client,google}.ts`             | Env gating, pure REST client, GIS / Picker glue                                                     |
| `src/interop/storage/types.ts`, `registry.ts`, `config.ts` | The `StorageProvider` interface; which providers this build offers (env-gated, lazy)                |
| `src/interop/storage/{device,gdrive,onedrive,dropbox}.ts`  | The providers; OneDrive and Dropbox include their REST clients                                      |
| `src/interop/storage/oauth.ts`, `http.ts`                  | PKCE popup sign-in, in-memory tokens; authorised fetch, capped reads                                |
| `src/interop/storage/testProvider.ts`                      | Dev-only fake provider for e2e (`?storage=test`)                                                    |
| `public/auth.html`, `privacy.html`, `terms.html`, `brand/` | OAuth redirect page; the privacy policy and terms; the logo PNGs for the providers' consent screens |
| `src/interop/files.ts`, `image.ts`, `icons.ts`             | File System Access and downloads, PNG/SVG rendering, icon inlining                                  |
| `src/interop/useInterop.tsx`                               | Controller: File menu actions, shortcuts, drag-and-drop, share-hash handling, canvas menu actions   |
| `src/interop/ui/*`                                         | File menu, dialogs, toasts (`notify`), drop overlay, glyphs                                         |
| `src/interop/embed/EmbedView.tsx`                          | `?embed=1` viewer                                                                                   |
| `src/styles/interop.css`                                   | Styles (prefixed `ix-`)                                                                             |
