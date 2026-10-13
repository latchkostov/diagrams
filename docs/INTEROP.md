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
| **Open…** (Ctrl+O)           | `.diagram.json`, `.drawio`, `.xml`, `.drawio.svg`, `.mmd`, docker-compose, Kubernetes and AsyncAPI `.yml` / `.yaml` / `.json`, Terraform plan or state JSON (`terraform show -json`), several files at once. A draw.io file with several pages asks which page to open. |
| Open from ▸ / Save to ▸      | Only when at least one cloud provider is configured (see "Storage providers" below); otherwise hidden completely, and **Save as…** stays a plain row. Each lists **This device** first, then the configured providers. Save to ▸ always makes a new file.               |
| **Export PNG**               | 2×, whole diagram, independent of pan and zoom.                                                                                                                                                                                                                         |
| **Copy share link**          | One click; the toast's **Details** opens the dialog (length, warning above 8k characters, native Share).                                                                                                                                                                |
| **Copy link with password…** | Encrypts the diagram into a `#e=` link with a password (8+ characters, strength hint); see "Share links and embeds" below.                                                                                                                                              |
| More formats ▸               | Diagram file (`.diagram.json`, lossless, simulations included) · Image… (PNG or SVG; scale and transparent background behind **Options**) · **Interactive HTML…** (one self-contained file, below) · draw.io · Mermaid file (`.mmd`) · Copy as Mermaid                  |
| Import from ▸                | Paste text… (JSON, draw.io XML, Mermaid, docker-compose, Kubernetes, AsyncAPI or Terraform JSON, auto-detected) · Share link…                                                                                                                                           |

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
  Drive, draw.io, Mermaid and infrastructure (compose, Kubernetes, AsyncAPI) converter output, and storage reads (`getImported` / `getShared` / `getAutosave`).
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
  (`layout.ts`) → `validateDiagram`. Kubernetes, AsyncAPI and Terraform have their own readers on the same chunk;
  a Helm template says to run `helm template`, and Terraform source (`.tf`) says to run `terraform show -json`.
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
- **Replicas** from `deploy.replicas` (or `scale`), one included, after the file's own `${VAR:-default}`; a service
  that doesn't say has none, so the `single-point` check reads only what the file says.
- **Boundaries** are the networks when they divide the services (two or more, and 80% of services on exactly one);
  a service on several goes where most of its connections are, and the report says so.
- **The Import report** (`ui/ImportReportDialog.tsx`, lazy) opens from the toast's **Details** ("Imported “shop”
  from docker-compose: 15 nodes, 17 connections. 2 guesses.", 7 s when there's something to check) and from Ctrl+K
  "Import report" while that diagram stays open. Sections: guesses with stencil chips (one undo step each, the
  editor's own stencil change) and **Other…** (a catalogue search); connections found in settings with the
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
- **Big imports** (`infra/pick.ts`, every format). The picker's entries are the boundaries and, when there is any,
  **Not in a boundary** (everything in none: a Terraform root module, Users, outside services), so nothing is out of
  reach. Past 300 nodes, an import with two or more entries draws the ones with the most flows, each added while the
  drawing stays within 300, plus the loose nodes connected to them. The first one is taken even past 300, but no
  entry is ever taken past 5,000 with its loose nodes: an oversized one is skipped and still listed, so a smaller one
  opens; if none fits on its own the import says "No boundary in it fits in 5,000 nodes, the most an import draws."
  The toast says "300 of 1,240 nodes", and the report's **Boundaries** section lists every entry, the most flows
  first, with its nodes and flows and a checkbox, in a list that scrolls on its own. **Draw these (n nodes)** opens
  the ticked ones as a new diagram titled by what it draws ("shop (team-05 and team-39)"), keeping the import's
  privacy and, for Terraform, its Draw everything. While it can't (nothing changed, nothing ticked, over 5,000) it's
  unavailable rather than disabled, so it stays in the Tab order, and a status line beside it, which the checkboxes
  and the button are described by and screen readers announce politely, gives the ticked total and why. The report
  keeps the whole import as data (names and connections, never the source text) for that, in memory only. An import
  over 5,000 nodes with boundaries opens this way instead of failing; one without boundaries still fails with the
  budget message. Tests: `infra/pick.test.ts` (the default pick, drawing a pick again, the ungrouped entry, an
  oversized first boundary, loose nodes past the cap, over 5,000, Draw everything, titles, no values in the kept
  import) and the big-import part of `tests/e2e/imports.spec.ts`.
- **Layout of big and flat imports.** Each column is restacked by its own units' heights (the layered layout spaces
  every row by the tallest unit, so one boundary spread every column), and centred on one line. Past six units with
  no flow, inside a boundary or out, they skip the layered pass and pack in a grid under the flows, its rows about
  as wide as it is tall and never narrower than the flows above. Columns are built by appending (linear; a fan-out
  of thousands into one column is covered by a scaling test in `infra/layout.test.ts`).
- **One connection per pair, enriched.** A dependency found twice (a reference, then a grant) stays one connection
  and takes what the later source adds: a label it lacked ("managed identity"), settings it didn't name, and
  evidence a person can trace (a resource or a setting) over the file's bare structure. A flow another source
  implies (a KafkaUser ACL) joins the route between the same ends: one with no consumer group takes the new one's,
  one that names its own keeps it, and only ends with no route get a new one (`Links.flowOrEnrich`).
- **Copy.** The drop overlay lists `docker-compose.yml`, Kubernetes, AsyncAPI and Terraform plan, the paste dialog
  names all four, and the start card has one line, "Drop a docker-compose, Kubernetes, AsyncAPI or Terraform plan
  here."

### Infrastructure imports: AsyncAPI 2.x and 3.x (`src/interop/infra/asyncapi.ts`)

Batch 2. Our own reader (about 4 kB gzip in the same lazy chunk): `@asyncapi/parser` compiles schemas with
`new Function`, which the CSP forbids.

- **One document is one application.** In 3.x `send` means it sends; 2.x inverts the words (`subscribe`: it sends,
  `publish`: it receives), checked by the 2.6 fixture. An operation's `reply` draws the answer back.
- **Joining.** Several documents are one diagram: a channel is its address on a server (protocol family and host),
  so a producer in one file and a consumer in another meet on one node; apps with the same title are one node. The
  same address on another cluster stays a separate topic.
- **Servers** are boundaries ("Kafka · kafka-0.shop.internal:9092"), tinted by host (Azure, AWS, GCP), holding
  their channels; apps stay outside.
- **Channels** take a stencil from the protocol and binding: Kafka (Confluent Cloud and MSK by host), RabbitMQ
  exchange or queue (`is: queue` wins when files disagree, and the report names the exchange), Service Bus by
  host, SNS, SQS, Pub/Sub, Pulsar, NATS, Redis Streams and the new **MQTT Broker**. Solace, IBM MQ, JMS, STOMP,
  HTTP and WebSocket channels are drawn as a Topic or Queue and listed as guesses with chips.
- **Typed messages.** A send with one message sets the edge's `emits`; a receive lists its messages in `filter`;
  the Kafka `groupId` (`const` or a single `enum`) becomes `group`. An address that says dead letter (`dlq`,
  `dlt`, `dead-letter`) is the app's DLQ route. Kafka `partitions` and Avro or Protobuf content types (as
  `contentType`, which the schema-registry check reads) go on the channel.
- **Schema Registry** from a Kafka server's `schemaRegistryUrl`, or added when its messages use Avro or Protobuf
  (the report says so), with **Depends on** from every app using that server.
- **Imported traffic.** A saved simulation of 1 msg/s for 2 minutes at each app where messages start (one that
  sends and whose inputs nobody in the files produces), with its first message type, so the first Go live shows
  typed messages flowing. The report lists the entry points and rates.
- **The report** also lists channels no operation uses, messages no channel uses, security schemes and payload
  schemas (counted, not drawn), channels with no producer in the files, and every `$ref` it couldn't follow.
- **`$ref`.** Local (`#/…`) and into files opened together; remote ones are never fetched and are listed. 32
  references in a row at most, cycles stop where they close, and 10,000 per import. A document whose channels
  can't be read at all fails with the first reason ("…a remote reference, never fetched: open that file too").
- **Tests.** `infra/asyncapi.test.ts` (the three fixtures together and alone, protocols, replies, clusters, the
  hostile refs), the AsyncAPI part of `tests/e2e/imports.spec.ts` (join, Go live with Imported traffic, 2.6
  direction, remote `$ref`, no network) and the Lab's "Imported: AsyncAPI" overlap audit. The entry grows by 48 B.

### Infrastructure imports: Kubernetes manifests (`src/interop/infra/kubernetes.ts`, `k8sHosts.ts`, `k8sSettings.ts`)

Batch 3. Our own reader on the same lazy chunk (about 6.7 kB gzip with the shared settings code it now uses, in
`links.ts`). The entry grows by about 70 B (the kubectl JSON sniff and the wiring). JSON is recognised by its
`apiVersion` and `kind` in any order, anywhere in the text (a ConfigMap's data may come first).

- **Reading.** Several files, each with several documents, are one diagram; `kind: List` (and `*List`) items are
  read too, so `kubectl get all -o yaml` or `-o json` output works. 2,000 YAML documents and 10,000 resources per
  import at most. Pods, ReplicaSets and Jobs fold into an owner in the files that runs pods itself; anything else
  an owner makes (a Deployment an operator's custom resource manages) is drawn.
- **Workloads** are found by their pod template, not their kind: Deployment, StatefulSet, DaemonSet, Pod, Argo
  Rollout, Knative Service, KEDA ScaledJob. The main container (not a known sidecar such as `istio-proxy`) gives
  the stencil through the compose image table, then its settings' names, then its name, then **Kubernetes
  Deployment** as a guess with chips. `spec.replicas` gives `replicas`, one included; left out, it stays unset (a
  base an overlay or an autoscaler scales leaves it out). Under an HPA or a KEDA ScaledObject the manifest's own 1
  is dropped, and the autoscaler's minimum, when the file sets it, is the count. A CronJob is a **Scheduler** subtitled with
  its schedule, so it sends in Live; a Job is a **Batch Job**. ZooKeeper and developer-tool images aren't drawn,
  as in compose.
- **Services** aren't nodes: a request to one goes to every workload its selector matches. One with no matching
  workload is a Service node, "no workload in these files", and the report says so. `ExternalName` is an outside
  node (a product when the host is known); `LoadBalancer` adds **Users** → its workloads.
- **Entry points.** An Ingress is a gateway node of its class (`ingressClassName` or the old annotation: NGINX,
  Traefik, HAProxy, Kong, Istio, AWS ALB, GCE, Application Gateway, else Load Balancer), with Users → Ingress →
  each backend. Gateway API `Gateway` and its `*Route`s (`parentRefs`, `backendRefs`) work the same way; a parent
  Gateway that isn't in the files is drawn and says so.
- **Namespaces** are boundaries (tone Kubernetes) when the files name a namespace; Users, outside services and
  identities stay outside. The title names the namespaces ("shop and kafka").
- **ConfigMaps and Secrets** from `envFrom`, `configMapKeyRef`/`secretKeyRef` and (projected) volumes are nodes with
  a **Config** or **Secret** dependency whose settings are the keys used, Secret keys marked secret. ConfigMap
  values are read in memory like inline settings, to find hosts. **Secret `data` and `stringData` values are never
  read**: only their key names. A referenced one that isn't in the files is drawn, "not in these files". TLS,
  image-pull and service-account-token Secrets aren't drawn.
- **Workload identity.** A ServiceAccount annotated for Azure (`azure.workload.identity/client-id`), AWS IRSA
  (`eks.amazonaws.com/role-arn`) or GKE (`iam.gke.io/gcp-service-account`) gives a Managed Identity, an IAM Role
  (named by the role) or the new **Service Account** (Google Cloud, named by the account), with an **Identity**
  dependency from each workload running as it. Client ids, account numbers and projects aren't shown.
- **Connections from settings** use the compose rules (`linkSettings` in `links.ts`, shared with compose).
  - **Each container's environment is its own** (`k8sSettings.ts`), built as the kubelet builds it: `envFrom`
    sources in order, a later one overriding an earlier one, then `env`, which beats them all. A Secret's keys
    override with a value that's never read, so a ConfigMap setting a later Secret replaces connects nothing; so
    does `env` from a Secret or a field. A workload's connections are the union of its containers'.
  - **`$(VAR)`** expands once, from the same container's earlier variables. Values are bounded while they're built:
    past 2,048 characters, 64 references, or with an unknown part, a value is unknown and connects nothing. One
    import materializes at most 100,000 settings across all containers (a ConfigMap shared by many workloads
    counts each time); past that the report says settings weren't read.
  - **Host names** (`k8sHosts.ts`) are parsed before anything is looked up: `svc`, `svc.ns`,
    `svc.ns.svc[.cluster.local]`, and StatefulSet pods by their ordinal (`db-0.db`, `db-0.db.data`). An explicit
    namespace that isn't in the files stays unresolved; it's never read as a local name. Names that look
    in-cluster are never taken for outside APIs. Workloads are indexed by kind and name (`WorkloadNames`), so a host
    costs a few lookups however many workloads there are; its scaling test times resolution on its own.
- **KEDA.** A ScaledObject's `kafka`, `rabbitmq`, `aws-sqs-queue` and `azure-servicebus` triggers draw the topic or
  queue with a **Message** to the workload it scales (`group` from `consumerGroup` or the subscription). The replica
  range goes in the report, and `minReplicaCount` above the Deployment's replicas becomes `replicas`. Other
  triggers (CPU, cron…) are listed as "scaling only". An HPA's range is a report note too.
- **Strimzi.** `Kafka` and `KafkaTopic` in `v1beta2` and `v1`: the cluster is shown through its topics (in its
  namespace, with `partitions`), scoped to the cluster, and listed as "shown through its topics". A cluster is its
  namespace and name, from a topic's `strimzi.io/cluster` label or a bootstrap host, whether or not its `Kafka`
  manifest was opened; a topic with no label is scoped to its namespace. A cluster with no
  topics is a Kafka Cluster node. Bootstrap hosts (`<cluster>-kafka-bootstrap.<ns>.svc`) name the cluster, so a
  KEDA trigger and an `INPUT_TOPIC` meet on the same topic. KafkaConnect is drawn; KafkaNodePool and the rest are
  "part of Kafka".
- **KafkaUser ACLs** (`authorization.type: simple`). The User Operator writes a user's credentials to a Secret named
  after it (with the cluster's `entityOperator.userOperator.secretPrefix`) in its namespace, and a pod can only use
  Secrets in its own: a workload there that reads or mounts that Secret is the user. Its allowed literal topic ACLs
  are flows, listed under the connections with "KafkaUser <name>": Write (or All) produces, Read consumes, in the
  consumer group of its one literal group ACL. **A deny wins**, as Kafka applies it: a deny ACL for the operation (or
  All) on the topic, by literal name, prefix or `*`, for any host or one, forbids the flow, and a denied group isn't
  the consumer group. A pair the settings already connect gets no second edge, but a settings consumer with no group
  takes the ACL's, so two consumers of one user share it in Live. Prefix and `*` allows, and allows for some hosts
  only, are a note ("orders-app (KafkaUser) may read topics starting “audit.”: not drawn"), Describe-only ACLs draw
  nothing, and a user no workload here uses is listed ("its ACLs aren't drawn: no workload in these files uses its
  Secret"). Workloads are indexed by the Secrets they use (`SecretUsers`), so each user is one lookup. Only the
  Secret's name is looked at, never its values.
- **Report rows** name the namespace when there's more than one ("orders (staging)"), in the row and in its chips'
  accessible names, so two workloads with one name can be told apart. The canvas label stays short.
- **Not drawn**, grouped by kind and reason: "ServiceMonitor orders-api · unknown kind (monitoring.coreos.com)",
  "PersistentVolumeClaim ×4 · not a component", "Pod ×12 · folded into its owner", ConfigMaps and Secrets no
  workload uses.
- **Helm.** A chart's templates (`{{ .Values… }}`, `.Release`, `.Chart`, `include`) are refused with "This looks
  like a Helm template ({{ .Values… }}). Run “helm template” and import its output.", wherever the template is in
  the file. Among other files, it's listed as not read with the same hint.
- **Big imports** pick namespaces (see "Big imports" under docker-compose, which every format shares).
- **Tests.** `infra/kubernetes.test.ts` (the fixture set end to end, the Secret-values leak test, KEDA, Strimzi in
  both versions, entry points, identities, host forms, not-drawn grouping, kubectl JSON and Lists, Helm, alias
  bomb, nesting, 2,000 documents (and a linear-time ratio), the resource cap, prototype keys, linear patterns, and the
  review's cases: per-container environments, `envFrom` precedence, bounded expansion and the settings budget, DNS
  parsing, Kafka identity without manifests, owners that aren't drawn, JSON in any key order), the
  Kubernetes part of `tests/e2e/imports.spec.ts` (Open… and drop, boundaries, the Ingress entry, config, secret
  and identity relationships, the KEDA consumer, report rows, Helm, no network) and the Lab's "Imported:
  Kubernetes" overlap audit. `bundleSplit.build.test.ts` names the Kubernetes reader.

### Infrastructure imports: Terraform plan and state JSON (`src/interop/infra/terraform.ts`, `tfRefs.ts`, `tfTypes.ts`)

Batch 4. Only `terraform show -json` output is read, a plan (`planned_values`, `resource_changes`, `configuration`)
or a state (`values`), format version 1. HCL isn't parsed: a `.tf` file (by name or by its `resource "…" "…" {`
blocks) says "Terraform source (.tf) isn't read. Run “terraform show -json plan.out” (or state) and import that.",
a binary plan (a zip) says to run `terraform show -json plan.out > plan.json`, and a raw `.tfstate` says to run
`terraform show -json`. Plain JSON, so no new dependency: the reader is about 10 kB gzip on the same lazy chunk,
and the entry grows by about 240 B (the key-order-independent sniff, the format and the copy).

- **Recognising it.** `"terraform_version"` with `"format_version"` (or a raw state's `"lineage"`) anywhere in a
  JSON object, in any key order (`jq -S` puts them after a long `configuration`). A plan that manages Kubernetes
  objects mentions `apiVersion` and `kind` too; its `root_module` says it's Terraform. A Kubernetes object whose
  data holds a plan's text stays Kubernetes (escaped quotes never match).
- **Components.** A whitelist of types (`tfTypes.ts`, the plan's table): AWS SQS, SNS, Kinesis, MSK, MQ,
  EventBridge buses, Lambda, ECS services, Step Functions, load balancers, API Gateway, CloudFront, WAF,
  DynamoDB, S3, ElastiCache, RDS and Aurora (by `engine`), Secrets Manager, Parameter Store and IAM roles; Azure
  Service Bus, Event Hubs, Event Grid, Storage Queues, Function Apps, App Service, Container Apps, AKS, SQL,
  PostgreSQL, Cosmos DB, Redis, Storage, Key Vault, App Configuration, managed identities, API Management,
  Front Door, Application Gateway and Application Insights; Google Pub/Sub, Cloud Run, Cloud Functions, GKE,
  Dataflow, Cloud SQL, Spanner, BigQuery, Cloud Storage, Firestore, Memorystore, Secret Manager, service accounts
  and Cloud Scheduler; Confluent and Kafka topics. Labels are the resource's own name (`function_name`, `bucket`…)
  unless it's sensitive or credential-shaped. `count` and `for_each` instances are one node, "×3". A data source
  of a drawn type is drawn, "data source". A type that sounds like a component (`_function`, `_queue`,
  `_cluster`…) is drawn as a guess with chips.
- **Flows from glue resources** (`resource` evidence, listed in the report under "Connections from subscriptions,
  mappings and grants" with the resource's address): SNS subscriptions (SQS, Lambda, an HTTPS endpoint as an
  outside node named by its host only), Lambda event-source mappings (SQS, Kinesis, MSK with its consumer group,
  DynamoDB streams), EventBridge rules and targets (a rule on a bus, or on the default bus; a scheduled rule is a
  Scheduler), S3 notifications, SQS redrive policies and Lambda dead-letter targets (DLQ routes), load balancers
  through listeners and target groups to their targets and ECS services, API Gateway integrations, Service Bus
  subscriptions and queue forwarding (the subscription is the consumer group), Event Grid system topics and event
  subscriptions (functions, queues, event hubs, webhooks), Pub/Sub subscriptions (push to Cloud Run or outside,
  Cloud Storage, dead-letter topics), Cloud Functions triggers and Cloud Scheduler jobs. A route is its ends, its
  kind, its consumer group and whether it carries dead letters (`links.ts`, shared by every reader): two
  subscriptions forwarding one topic to one queue are two routes, and a dead-letter route beside an ordinary one is
  its own.
- **References as dependencies.** In a plan, each drawn resource's `configuration…expressions.*.references` are
  followed (through module variables and outputs, cached, a cycle resolving to nothing, 256 hops and 200,000 steps
  at most) to the drawn resources they name. Terraform lists `module.queues.a_arn` with its ancestor
  `module.queues`; the ancestor is dropped, so only a reference to the whole module means every output. Each
  reference and each target is expanded once per resource, and every target visited, cached or not, counts against
  2,000,000 for the import (past that the report says some references weren't followed). The relationship: an IAM role or managed identity gives **Identity**, Secrets Manager or
  Key Vault **Secret**, Parameter Store or App Configuration **Config**, anything else **Depends on**. An ECS
  task definition passes its roles and secrets to its service. A state has no configuration: identities come from
  `role`, `role_arn`, the task definition's roles and `identity.identity_ids`. `constant_value` is never read.
- **Grants.** An IAM role policy (inline or attached) that names a secret or a parameter gives every component
  running as that role a Secret or Config relationship. An Azure role assignment reads its role: a Data Receiver,
  Reader or Subscriber on a queue, topic or hub is a flow to the principal; a Sender or Publisher a flow from it; a
  Key Vault role a Secret relationship; anything else Depends on. A Key Vault access policy is a Secret
  relationship. Principals are a component's own identity, or the components running as a user-assigned one.
  Grants are collected once per role and store before they're expanded across the role's components, so thousands
  of policies granting one secret cost one expansion. A Secret or Config relationship that comes from a grant to a component's own (system-assigned)
  identity is labelled "managed identity" on the canvas, since no identity node says it.
- **Identity is scoped.** Resources are keyed by file, module path and address. Joins by value use ARNs and ids
  (Azure ids case-insensitively); a bare name joins only when exactly one resource in that file has it, so a
  function name shared by two regions joins nothing and the mapping is listed. A value shared by more than 50
  resources identifies none, in any order: its key is saturated for good (`tfIndex.ts`), never left as a partial
  set. EventBridge rules are found by bus and name (a target that names no bus means the default one).
- **Boundaries.** Modules (`module.streaming`, nested ones by full path), else Azure resource groups (the
  resource's own, the one in its id, or its namespace's or server's), toned by provider. Several files are one
  diagram, joined on ARNs; each file's resources stay its own.
- **Addresses wrap between their parts.** The report's evidence column and its "Couldn't read" names break after
  "." and "/" and before "[" (`<wbr>`, so `module.streaming.aws_lambda_event_source_mapping.analytics` wraps after
  `module.streaming.`, never inside a name) and can be selected and copied whole.
- **The report.** Not drawn, grouped by type with a reason ("aws_iam_policy ×14 · access and permissions",
  "azurerm_servicebus_namespace shop · shown through its queues and topics", "random_password db · helper, not
  infrastructure", "aws_s3_bucket_versioning v · part of aws_s3_bucket", "aws_sqs_queue legacy · destroyed by this
  plan"), and a summary note ("7 supporting resources aren't drawn: access and permissions, parts of what's drawn,
  monitoring, networking and helpers"). A plan adds "Plan: 28 to add, 0 to change, 1 to destroy". **Draw
  everything**, beside the Not drawn heading, opens the same files again as a new diagram with every managed
  resource as a node (its type as the subtitle), all of them up to 5,000 (past that, the boundaries with the most flows up to 5,000, and the picker for the rest); resources with no flows pack in a grid below the flows. That
  diagram is read at import time and kept beside the report as data (names and connections, never the source
  text), until another diagram opens. The resources drawn only there (policies, a secret's version, a password)
  refer to things as plain **Depends on**: they run as nothing and read nothing. It's made from the import, so it keeps the import's privacy (Private, or
  local-only) whatever **New diagrams are private** says, and the focus moves to its canvas.
- **Values never leave the file.** Only a whitelist of attributes is read (names, ARNs, ids, `engine`,
  `protocol`, endpoints, schedules, role names, principal ids), never one marked in `sensitive_values`, and never
  `variables`, outputs or `constant_value`. What can reach the diagram: resource names, outside host names and
  schedules. ARNs, ids, account numbers, principals, connection strings and URL userinfo or query strings don't.
- **Bounded.** 10,000 resource instances per import, 100 read per resource, modules 32 deep (deeper ones are listed
  under "Couldn't read"), expressions 16 deep and a million values visited, 2,000 module calls or outputs and 1,000
  attributes per block (past those the report says some references weren't followed), 200 connection rows, and the
  validator's node and edge budgets before any layout. Expressions are walked one frame per level of nesting, not one
  per element, and the walk stops as soon as the budget is spent. `JSON.parse` is native; parsed objects are read with own
  keys only, so `__proto__` stays a name.
- **Tests.** `infra/terraform.test.ts` (both fixtures end to end, flows, dependencies through modules, grants,
  boundaries, the report and Draw everything, overlap-free layout, the no-values leak test over both fixtures and
  Draw everything, sensitive attributes, outside endpoints, glue across services, scoped names, the type table,
  `.tf`, binary and raw-state messages, key order, 10,000 resources (and a linear-time ratio), deep modules, reference
  cycles and long chains, prototype keys, linear patterns, and the review's cases: distinct subscription routes,
  module-output ancestors, repeated references, grants across thousands of policies, saturated ARNs in either
  order, rules per bus, an Object-named type, huge arrays), the Terraform part of `tests/e2e/imports.spec.ts`
  (Open… and drop, SNS → SQS → Lambda, the module boundary, report rows and the supporting summary, Draw
  everything, which keeps a manually private import private and focuses the new canvas, `.tf`, no network) and the
  Lab's "Imported: Terraform (AWS plan)" and "(Azure state)" overlap
  audits. `bundleSplit.build.test.ts` names the Terraform reader. Fixtures: `tests/fixtures/imports/terraform/`
  (`aws-plan.json`, `azure-state.json`, self-written).

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
- A self-hosted copy can be built without links (`VITE_DISABLE_SHARE_LINKS`: nothing makes one, `canShareAsLink` is false
  for every diagram) or without opening them (`VITE_DISABLE_LINK_OPEN`); see [SELF-HOSTING.md](SELF-HOSTING.md).
- `?embed=1&example=<slug>` (public examples only), `?embed=1#d=…` or `?embed=1#e=…` renders a read-only viewer: no top bar,
  fitted, pan and pinch-zoom only (the wheel scrolls the host page), no menus, shortcuts or autosave, and a
  subtle "Open in Diagrams" link. `live=1&sim=<id>` pass through for the live view.
- `?embed=1&host=1&hostOrigin=<origin>` is the **host-supplied embed** (`src/interop/embed/host*`,
  `public/embed/live-diagram.js`; full reference in `docs/EMBEDDING.md`): the page that frames it fetches the diagram
  from its own server and hands it over with `postMessage` (protocol `livediagrams.embed.v1`), so it's never in a
  URL, in storage or on our side. The viewer reads messages only from `window.parent` at `hostOrigin`, replies only
  to `hostOrigin` (never `"*"`), bounds sizes and rates, treats the diagram as private (no link out but a plain
  "Made with Live Diagrams") and takes commands (play, pause, speed, simulation, fit, theme, highlight, load) and
  reports events (node clicks, play state, simulation, auto-height). The `<live-diagram>` web component wraps it.
- The embed dialog previews the iframe, and its options (height, simulation) sit behind **Options**. Its source
  is **Example by name**, **In the link** or **Your app supplies it (private)**, with a web-component and an
  iframe + `postMessage` snippet; the last one's preview gets the diagram by `postMessage` too. A Private or
  local-only diagram opens the dialog with only that source (its Embed code… stays enabled, hinted "Your app
  supplies it"): nothing of the diagram goes in the code.

### Interactive HTML (`src/export/`, `scripts/interactive-viewer.ts`)

For diagrams that mustn't be on a public URL (a company's systems, a Private diagram): **File ▸ Export as ▸
Interactive HTML…** (also the canvas right-click's Export ▸ and Ctrl+K) downloads **one self-contained `.html`
file**, `<title>.html`. Host it where the team already controls access (SharePoint, Confluence, an intranet, a
private repository) or open it from disk. It shows the diagram read-only (pan, zoom, fit) with live playback: the
simulation picker, play and pause, speed, slow motion, trace and the rest of the live bar.

- **The dialog** is simple by default: a summary line ("Light theme · 2 simulations · plays “Black Friday” when
  opened"), the one line **"Anyone who has this file can open it."** and **Download HTML**. **Options** holds the
  title, a banner ("Confidential: internal use only"), Light or Dark (the app's theme by default), which
  simulations go in and which plays when the file opens (the first, or none).
- **Privacy.** Allowed for every diagram, Private ones and the development-only local-only examples included, exactly
  like Diagram file: it's the person's explicit action, like saving to this device. The file is made in the page;
  nothing is uploaded.
- **Require a password** (`src/export/lock.ts`; a checkbox in the dialog, off by default) is for a file that may be
  forwarded beyond the team (email, chat, a shared drive). The field is Copy link with password…'s own
  (`src/interop/ui/PasswordField.tsx`: at least 8 characters, the strength hint, Show; no confirm field), and the
  dialog's line becomes **Only people with the password can open it.** The whole payload (the diagram with its title,
  labels, notes, properties and simulations, the icons it uses, the banner, the options and the export date) is
  raw-DEFLATE compressed and encrypted with password links' crypto, `src/interop/passwordCrypto.ts`: PBKDF2-HMAC-SHA-256
  at 600,000 iterations over a fresh 16-byte salt, AES-256-GCM with a fresh 12-byte IV, a 128-bit tag and the
  additional data `livediagrams:e:v1`, as the same `v1.<salt>.<iv>.<ciphertext>` token. Nothing is copied: the link and
  the file call the same functions, and `src/export/lock.test.ts` checks WebCrypto is called identically for both.
  - **In the clear**, only: the viewer itself (the template, identical for every file), the theme (so the prompt paints
    in it), the format version, the token, and the neutral `<title>` **Diagram (password protected)** and a name of it with five
    random letters and digits (`LOCKED_TITLE`, `lockedFileName`: "Diagram (password protected) k7m2q.html"; nothing
    from the diagram or the time, and two exports never share a name). The dialog's title goes inside. The file's size shows roughly how big the diagram is. Private
    or not isn't visible either: the `"private"` flag is inside.
  - **Opening it** shows **This diagram is password-protected**, one field (focused) and **Open** (Enter). A wrong
    password says **That password doesn't open this file. Check it and try again.**, keeps what was typed, selected, and
    can be retried at once; there's no lockout (an offline file couldn't keep one), each try costs the 600,000
    iterations instead. Once it opens, the icons join the viewer's icon map, the page title becomes the diagram's (in
    that tab only), and focus moves to the diagram. The prompt is no `<form>`: a frame sandboxed without
    `allow-forms` never submits one.
  - **Nothing changes about the page:** the same CSP and hashes (WebCrypto and `DecompressionStream` need no
    directive), zero requests, no storage, and the password is never kept or sent. A lost password can't be
    recovered: export again.
  - **Browsers.** WebCrypto needs a secure context. A file opened from disk is one in Chromium (checked in
    `tests/e2e/html-export.spec.ts`, framed and sandboxed too), Firefox and Safari's WebKit (Firefox 157 and
    Playwright's WebKit 27.2 on Windows, checked by hand: the prompt, a wrong password, then the diagram playing).
    So is any `https://` host and `http://localhost`. A plain `http://` intranet host isn't: there the prompt says the
    browser can't unlock the file here, and to open it from disk instead.
- **What's in it.** The viewer (React, React Flow, the canvas and the live session, about 0.98 MB minified), its CSS,
  Mona Sans and Geist Mono (Latin, as data URIs; other scripts fall back to system fonts), the diagram JSON and
  only the icons it uses (SVG data URIs). Template 1,233 kB raw / 419 kB gzip (the password prompt and decryption
  added 6.7 kB / 2.2 kB); the Kafka example exported with both simulations and a banner 1,261 kB / 430 kB, and with a
  password about 1,250 kB (its payload is compressed before it's encrypted). The editing-only panels (inspector, stencil rail, start card,
  first-run hint, shortcuts sheet, simulation editor) are stubbed out of it: the read-only canvas never shows them.
- **Zero requests.** A strict policy in a `<meta http-equiv="Content-Security-Policy">`: `default-src 'none'`,
  `script-src` and `style-src` each one `'sha256-…'` hash of the page's single inline script and style (no
  `'unsafe-inline'`), `img-src data: blob:`, `font-src data:`, `media-src blob:` (Record video's preview),
  `connect-src 'none'`, `base-uri`, `form-action` and `object-src 'none'`, and no `worker-src`. Also
  `<meta name="referrer" content="no-referrer">` and an empty `data:` favicon, so even an http host gets no
  `/favicon.ico` request. `frame-ancestors` can't be set from a meta tag: who may frame the file is the host's call.
- **Main-thread particles, no worker.** A module worker can't start from `file://`, and a `blob:` worker needs
  `worker-src blob:`, which a host's own CSP header (SharePoint's, say) may refuse on top of ours. The live renderer
  already has a main-thread fallback (`src/live/liveRenderer.ts`): the viewer marks workers unsupported at startup,
  and the build cuts the `new Worker(…)` out, so there's no worker file to fetch. It works everywhere the page does.
- **No storage, no AI, no links out.** Every `file://` page shares one `localStorage`, and a sandboxed frame throws on
  any access, so the viewer swaps `localStorage` and `sessionStorage` for in-memory stores before any app module is
  even evaluated (`src/export/viewer/storage.ts`, imported first and importing nothing; some modules read storage as
  they load): nothing is written, and the reader's own preferences (hidden dependencies, a theme) don't leak in. No editing, autosave, AI panel, WebMCP or share links
  (the build fails if their modules get in). There's no "Open in Live Diagrams" link either: one carrying the
  diagram would put it on a public URL, and even a plain one would tell livediagrams.dev (by its Referer) where
  the file is hosted. The footer says "Exported from Live Diagrams on 12 October 2026. Read-only." and the keys.
  React Flow's small credit link stays, as in the app; with `no-referrer` it reveals nothing.
- **Anywhere.** `file://`, any host, sub-paths and iframes. Framed, the wheel scrolls the host page (as an embed's
  does); on a page of its own it pans, as in the app. Keyboard: arrows pan (Shift: further), + and − zoom, Shift+1
  fits, Shift+0 is 100%; the zoom buttons and the live bar have names.

**How it's built.** `scripts/interactive-viewer.ts` runs a second Vite build of `src/export/viewerEntry.tsx` (IIFE, no
code splitting) beside the app's, inlines its script, CSS and fonts into one page, hashes them into the CSP and emits
it as `export/interactive-viewer-<content hash>.html` (a new name per change, so a cached copy is never stale). It
swaps modules for the viewer: the stencil icon URLs (`src/stencils/iconUrls.ts` → the payload's data URIs), the
dev-only local-example check, and the editing-only panels (`EDITOR_ONLY`, stubs with the same exports; the build
and `src/export/template.build.test.ts` fail if one comes back). The viewer's zoom buttons use the canvas's own
overlay-aware Fit view (`src/canvas/canvasFit.ts`), and every viewport move honours reduced motion. The app reads the file's name from `virtual:interactive-viewer` and fetches it
same-origin (`connect-src 'self'`) only when the dialog opens; none of it is in the startup JavaScript (the menu
item adds 0.19 kB gzip; `src/lib/bundleSplit.build.test.ts` checks). In `pnpm dev` the template is built on the
first request for `/export/interactive-viewer.html`.

The template is deterministic (no dates, build ids or environment variables), and the injection is
`src/export/inject.ts`: pure string work with no imports, so the app and a Node script make byte-identical files.
The template carries two JSON data blocks: `#ld-stencil-icons` (stencil id → icon name, to subset icons without the
catalog) and `#diagram` (the placeholder). Data blocks never run, so the payload doesn't change the CSP hashes.
From Node:

```ts
import { writeFileSync } from "node:fs";
import { buildViewerTemplate } from "./scripts/interactive-viewer"; // or read a built or committed template
import { exportHtml, htmlFileName } from "./src/export/inject";

const template = await buildViewerTemplate(process.cwd());
const html = exportHtml(template, {
  diagram, // a diagrams/v1 object
  iconSvgs, // icon name → SVG text, e.g. every src/stencils/icons/*.svg; only the used ones go in
  theme: "light",
  banner: "Confidential: internal use only", // optional
  simulations: ["black-friday"], // optional: which to keep (default: all)
  startSimulation: "black-friday", // optional: plays when the file opens
  exportedOn: "2026-10-12", // optional: fixes the footer's date, for reproducible output
});
writeFileSync(htmlFileName(diagram.title), html);
```

**From the agent skill, offline.** `skills/livediagrams/scripts/export-html.mjs <file> [--out path] [--theme light|dark]
[--banner "text"] [--title "text"] [--sim <id>] [--no-autoplay] [--password] [--force]` makes the same kind of file on plain Node (20 or
later, standard library only, no network): it validates the diagram with `validate.mjs`'s checks, then runs the
bundled injection on the bundled template with the bundled icons, and checks the finished payload with the viewer's own
`parsePayload` (size budgets, the diagram contract, icons, the 300-character banner) before writing anything, all in `skills/livediagrams/scripts/lib/`
(`scripts/skill-viewer.ts`). `--exported-on YYYY-MM-DD` fixes the footer's date. `--password` encrypts it with the
app's own `lockPayload` (bundled in `lib/app.mjs`), decrypts it once more to check, and names it `Diagram (password
protected) <random>.html`. It never replaces a file: a default name that's taken gets the next free one (" (2)", said on
stderr), a named `--out` that exists is refused, and only `--force` replaces. The password is never an argument (shell history, the process list and an agent's transcript keep
those): it comes from `LIVEDIAGRAMS_HTML_PASSWORD`, or a terminal prompt that doesn't echo and asks twice;
`--password=…` or a value after it is refused, and so is a run with neither the variable nor a terminal.

- `inject.mjs`: this module as plain JavaScript. Small and stable, so `pnpm schemas` keeps it current and the
  staleness test (`src/ai/skill/skill.test.ts`) compares it byte for byte.
- `viewer-template.html` (`buildViewerTemplate`, 1.2 MB minified) and `icons.json` (the SVG text of every icon the
  catalog uses, 387 kB) are **refreshed only on release**: `pnpm skill:release` (`scripts/skill-release.mjs`) rebuilds
  them, regenerates `inject.mjs` and bumps the plugin's version in `.claude-plugin/marketplace.json` (patch, or
  `--minor`): it stages every file, swaps them in by rename with the version bump last, and rolls back if a step
  fails, so a retry releases again. Run it when you want Claude Code users to get the latest viewer: the committed copy is what the
  marketplace installs from git. Neither `pnpm schemas` nor a build rewrites them, so pull requests that touch the
  canvas, live view or the export never conflict on an unmergeable minified file (`.gitattributes` also marks them
  `-diff`, generated, and `merge=ours`).
- **The site is always current.** The build serves `/skill/` and `/livediagrams-skill.zip` (`scripts/skill-assets.ts`)
  with the template the same build emits for the app and fresh icons, in place of the committed copy; the dev server
  does the same.
- **Staleness is reported, never blocking.** `pnpm skill:check` says whether the committed copy differs from a fresh
  build and always exits 0; the nightly workflow runs it and shows a warning on the run when it does.

The skill grows from 50 kB to about 607 kB zipped (the template is 415 kB of it). It's kept raw rather than gzipped:
the zip deflates it to the same size either way. Tests: `src/ai/skill/skill.test.ts` (the committed template is
self-consistent: its CSP hashes match its inline script and style, it has the payload placeholder once and
references nothing outside itself, and `icons.json` covers every icon it names; the script's file equals
`exportHtml` from `inject.ts` on the committed template for several option sets; a private diagram exports but gets
no link; bad input writes nothing; the version bump; the site's fresh copy) and `tests/e2e/skill-html.spec.ts` (the
same diagram and options as the app's download; opens from `file://`, renders and plays with zero requests; a
private diagram; the build's `/skill/` template and zip are this build's viewer).

The JSON is escaped for a `<script>` element (every `<` as a JSON unicode escape, so no `</script>` or `<!--`, and
U+2028 and U+2029 too). Both ends hold the whole diagrams/v1 contract: the app runs `validateDiagram` before it
writes a file, and the viewer bounds the payload before parsing it (12 MB in all, the diagram within the app's own
8 MB file budget, at most 400 icons of 200 kB), checks it with `validateDiagram`, takes only `data:image/` icons,
and shows a plain message for a damaged, oversized or newer file. Tests: `src/export/inject.test.ts` (injection, escaping,
subsetting, file names, the policy), `src/export/template.build.test.ts` (the real template: the hashes match,
nothing external, deterministic, the Kafka export) and `tests/e2e/html-export.spec.ts` (export from the build, open
from `file://`, in an iframe and in a sandboxed one (`allow-scripts`, storage denied), render, play, switch
simulations (the new one's narration, node status and clock), banner, zero requests, zero CSP violations, the
reader's storage untouched and their preferences kept out,
Private, Ctrl+K).

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
  allows only this site to frame it. The host-supplied embed (`?embed=1&host=1`) is one of these, and keeps
  `connect-src` as it is: its diagram is posted by the host page, never fetched by the frame.
- `/embed/*.js` (the `<live-diagram>` web component, loaded by other sites as a module script) also gets
  `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin` and
  `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` (an unversioned URL: fixes land within the
  hour). It runs under the host page's CSP: no eval, no inline styles (a constructed stylesheet).
- `Referrer-Policy: strict-origin-when-cross-origin` (other sites see only the origin; a referrer-restricted
  Google API key still works), `X-Content-Type-Options: nosniff`, a `Permissions-Policy` that keeps the
  microphone (dictation) and display capture (Record video) and turns off location, payment, USB and serial (only
  features every desktop Chromium recognises: an unknown one logs "Unrecognized feature" on every page), and `Cross-Origin-Opener-Policy: same-origin-allow-popups` (sign-in pop-ups keep their opener; not sent with
  `auth.html`).

A self-hosted copy uses the same policy without the outside origins, with frame-ancestors limited to the company's own
domains: `scripts/self-host-headers.ts` writes it for nginx and `_headers` hosts (`deploy/self-host/`,
`pnpm headers:self-host`; see [SELF-HOSTING.md](SELF-HOSTING.md#headers)).

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

| Path                                                       | Purpose                                                                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/interop/native.ts`                                    | Validation, `migrate`, `preserveUnknown`, `serializeNative`                                                     |
| `src/interop/formats.ts`                                   | Format detection, `importText` (one entry point for every import)                                               |
| `src/interop/codec.ts`, `xml.ts`                           | DEFLATE / base64url codecs; a dependency-free XML reader (Node has no DOMParser)                                |
| `src/interop/infer.ts`                                     | Label keywords → stencil                                                                                        |
| `src/interop/infra/*`                                      | Infrastructure imports: YAML, the compose, Kubernetes and AsyncAPI readers, stencils, settings, mapping, layout |
| `src/interop/ui/ImportReportDialog.tsx`                    | The Import report (lazy)                                                                                        |
| `src/interop/drawio/{read,write,mapping}.ts`               | draw.io converter plus fixtures in `drawio/fixtures/`                                                           |
| `src/interop/mermaid/{read,write}.ts`                      | Mermaid converter                                                                                               |
| `src/interop/share.ts`                                     | Share-link and embed URL helpers                                                                                |
| `src/interop/gdrive/{config,client,google}.ts`             | Env gating, pure REST client, GIS / Picker glue                                                                 |
| `src/interop/storage/types.ts`, `registry.ts`, `config.ts` | The `StorageProvider` interface; which providers this build offers (env-gated, lazy)                            |
| `src/interop/storage/{device,gdrive,onedrive,dropbox}.ts`  | The providers; OneDrive and Dropbox include their REST clients                                                  |
| `src/interop/storage/oauth.ts`, `http.ts`                  | PKCE popup sign-in, in-memory tokens; authorised fetch, capped reads                                            |
| `src/interop/storage/testProvider.ts`                      | Dev-only fake provider for e2e (`?storage=test`)                                                                |
| `public/auth.html`, `privacy.html`, `terms.html`, `brand/` | OAuth redirect page; the privacy policy and terms; the logo PNGs for the providers' consent screens             |
| `src/interop/files.ts`, `image.ts`, `icons.ts`             | File System Access and downloads, PNG/SVG rendering, icon inlining                                              |
| `src/interop/useInterop.tsx`                               | Controller: File menu actions, shortcuts, drag-and-drop, share-hash handling, canvas menu actions               |
| `src/interop/ui/*`                                         | File menu, dialogs, toasts (`notify`), drop overlay, glyphs                                                     |
| `src/interop/embed/EmbedView.tsx`                          | `?embed=1` viewer                                                                                               |
| `src/interop/embed/host*`, `public/embed/live-diagram.js`  | Host-supplied embed: protocol, reducer, live driver, auto-height, snippets; the web component                   |
| `src/export/inject.ts`                                     | Interactive HTML: payload injection, escaping, icon subsetting, file name, the file's CSP                       |
| `src/export/exportHtml.ts`, `HtmlExportDialog.tsx`         | Interactive HTML: fetch the template, gather icons, download; the dialog (lazy)                                 |
| `src/export/lock.ts`, `src/interop/passwordCrypto.ts`      | Interactive HTML with a password: encrypt and decrypt the payload with password links' crypto                   |
| `src/export/viewerEntry.tsx`, `src/export/viewer/*`        | The exported file's viewer: storage sandbox, payload reader, icon map, password prompt, page                    |
| `scripts/interactive-viewer.ts`                            | Builds the viewer template (its own Vite build) and emits it beside the app                                     |
| `src/styles/interop.css`                                   | Styles (prefixed `ix-`)                                                                                         |
