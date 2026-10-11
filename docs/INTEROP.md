# Import, export and storage

Everything runs in the browser. There's no backend: the app is a static site (first at
`latchkostov.com/tools/diagrams/`, later its own domain). Code lives in `src/interop/`.

## Research summary (October 2026)

| Topic                              | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | What we did                                                                                                                                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **draw.io file format**            | `.drawio` is an `<mxfile>` with one `<diagram>` per page. Each page holds either a plain `<mxGraphModel>` (the default for `.drawio` today) or the compressed form: `encodeURIComponent(xml)`, then raw DEFLATE, then base64. Cells may be wrapped in `<object>`/`<UserObject>` to carry custom properties. Child geometry is relative to its container. `.drawio.svg` embeds the mxfile in the SVG's `content` attribute.                                                                                              | Read every variant. Write uncompressed, with our fields as `<object>` properties, so a round trip is lossless.                                                                                                                  |
| **draw.io shape names**            | Azure: image shapes `image=img/lib/azure2/<category>/<Name>.svg` (checked against `jgraph/drawio` `img/lib/azure2/**`). AWS: `shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.<name>` (`lambda`, `sqs`, `sns`, `eventbridge`, `kinesis_data_streams`, `ecs`, `step_functions`, `s3`, `dynamodb`, `api_gateway`, `elastic_load_balancing`), with groups `mxgraph.aws4.group;grIcon=…`. Kubernetes: `shape=mxgraph.kubernetes.icon2;prIcon=pod / deploy / …`. There's no built-in Kafka, RabbitMQ or Postgres shape. | Mapping table in `src/interop/drawio/mapping.ts`. Stencils with no built-in shape export as an image style with our SVG icon inlined (`image=data:image/svg+xml,<base64>`). Checked by rendering an export in app.diagrams.net. |
| **Mermaid flowchart**              | `flowchart`/`graph` with `TB/TD/BT/RL/LR`. Node shapes: `[]` `()` `([])` `[[]]` `[()]` `(())` `{}` `{{}}` `>]` `[//]`, plus the newer `id@{ shape: cyl, label: "…" }`. Links: `-->` `---` `-.->` `==>` `--o` `--x` `<-->` `~~~`. Link labels as `-->                                                                                                                                                                                                                                                                    | text                                                                                                                                                                                                                            | `or`-- text -->`. Also `&`lists, chains,`subgraph id [title] … end`, and `%%` comments. | Parser in `src/interop/mermaid/read.ts`, writer in `write.ts`. |
| **Google Identity Services (GIS)** | Static SPAs use the _token model_: `google.accounts.oauth2.initTokenClient({ client_id, scope, callback })`, then `requestAccessToken()` inside a click (a popup). Tokens last about an hour. With `prompt: ''`, a returning user gets a new token without a consent screen. No client secret, no backend.                                                                                                                                                                                                              | `src/interop/gdrive/google.ts`. Scripts load lazily (preloaded when the File menu opens).                                                                                                                                       |
| **Drive scope**                    | `https://www.googleapis.com/auth/drive.file` is per-file access: only files the user picked with the Picker or that this app created. It's a non-sensitive scope, so Google needs no security assessment, just brand verification for production.                                                                                                                                                                                                                                                                       | `drive.file` only.                                                                                                                                                                                                              |
| **Google Picker**                  | Load `https://apis.google.com/js/api.js`, then `gapi.load('picker')`. Build with `PickerBuilder().addView(DocsView).setOAuthToken().setDeveloperKey(API_KEY).setAppId(PROJECT_NUMBER)`. `setAppId` must be the Cloud project **number**: it's what grants `drive.file` access to picked files. The API key must allow the app's referrers.                                                                                                                                                                              | Mime-filtered `DocsView` (JSON, draw.io, XML, text, SVG). `appId` defaults to the client id's numeric prefix.                                                                                                                   |
| **Drive API v3**                   | Create: `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart` (body `multipart/related`: JSON metadata part, then content part). Update in place: `PATCH …/upload/drive/v3/files/{id}?uploadType=multipart`. Read: `GET …/drive/v3/files/{id}?alt=media`.                                                                                                                                                                                                                                        | `src/interop/gdrive/client.ts`, unit-tested with a fake `fetch`. Files are `application/json` named `*.diagram.json`. A custom MIME type would hide them from Drive's preview and other apps for no real gain.                  |
| **File System Access API**         | `showOpenFilePicker` / `showSaveFilePicker` return handles you can write to again (true "Save"). Chrome and Edge on desktop only. Not in Firefox or Safari, and blocked in cross-origin iframes. Permission must be re-requested after a reload.                                                                                                                                                                                                                                                                        | Used when available (Ctrl+S re-writes the same file). Fallback: download, plus `<input type=file>`.                                                                                                                             |
| **Web Share API**                  | `navigator.share({ title, url })` works in Safari, on Android and in Chrome/Edge on Windows/ChromeOS; desktop Firefox doesn't support it.                                                                                                                                                                                                                                                                                                                                                                               | "Share…" button in the share-link dialog, shown only where supported.                                                                                                                                                           |
| **CompressionStream**              | `deflate-raw` works in Chrome 103+, Firefox 113+, Safari 16.4+ and Node 18+.                                                                                                                                                                                                                                                                                                                                                                                                                                            | Share links and draw.io decompression. No `pako`/`fflate`.                                                                                                                                                                      |
| **OneDrive (File Picker v8)**      | Works client-side, but needs an Entra ID app registration, MSAL.js (or hand-rolled PKCE) and the picker's postMessage protocol. That's about 30 KB of auth code plus separate setup for personal and work accounts.                                                                                                                                                                                                                                                                                                     | Not built. See "OneDrive and Dropbox" below.                                                                                                                                                                                    |
| **Dropbox Chooser / Saver**        | The Chooser (drop-in `dropins.js` plus an app key) returns a direct link we could fetch, so opening is practical. The Saver only accepts a _public URL_ to copy from, not a blob. So saving needs the full Dropbox API with OAuth PKCE (`files/upload` allows CORS).                                                                                                                                                                                                                                                    | Not built (same section).                                                                                                                                                                                                       |

## What's in the app

All of it lives under one **File** menu in the top bar (budget: about 7 top-bar controls, 12 items per menu
level). The canvas right-click menu has the same actions. The top bar is: view tabs, diagram picker,
**View** (node and edge style; it replaced the two selects), **File**, **Present** and theme. Below 1100px,
View, File and Present become icon-only, so the bar fits at 1024px without scrolling.

| File menu                                     | Notes                                                                                                                                                                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Save** (Ctrl+S)                             | Goes back to wherever the diagram came from or was last saved: the same device file (File System Access) or the same Google Drive file. Otherwise it asks where to save (or downloads, in browsers without the API). Ctrl+Shift+S is "Save as". |
| **Open…** (Ctrl+O)                            | `.diagram.json`, `.drawio`, `.xml`, `.drawio.svg`, `.mmd`. A draw.io file with several pages asks which page to open.                                                                                                                           |
| Open from Google Drive / Save to Google Drive | Only when configured (see below). Otherwise hidden completely.                                                                                                                                                                                  |
| **Export PNG**                                | 2×, whole diagram, independent of pan and zoom.                                                                                                                                                                                                 |
| **Copy share link**                           | One click; the toast's **Details** opens the dialog (length, warning above 8k characters, native Share).                                                                                                                                        |
| More formats ▸                                | Diagram file (`.diagram.json`, lossless, simulations included) · Image… (PNG or SVG; scale and transparent background behind **Options**) · draw.io · Copy as Mermaid · Mermaid file (`.mmd`) · Embed code… · Save as…                          |
| Import from ▸                                 | Paste text… (JSON, draw.io XML or Mermaid, auto-detected) · Share link…                                                                                                                                                                         |

You can also drop a file anywhere on the page to open it.

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
  Drive, draw.io and Mermaid converter output, and storage reads (`getImported` / `getShared` / `getAutosave`).
  Writes are validated too: `setImported` / `setShared` throw a readable error _before_ replacing a slot, so a bad
  file can't overwrite good work or crash the canvas. It checks every field the UI renders: string ids, stencils
  and labels; finite coordinates; edges pointing at real nodes; groups with finite, non-negative geometry; side
  and kind enums; and simulation shape (traffic, timeline, expectations). Malformed simulations are skipped with
  a reason.
- **Budgets for untrusted input** (`LIMITS`): 8 MB of text (files are checked by `File.size` before reading),
  48 levels of nesting (iterative walk), 5,000 nodes / 20,000 edges / 1,000 groups / 200 simulations /
  2,000 annotations, and compressed payloads (share links, draw.io pages) that stop inflating at the cap
  (zip-bomb guard). An annotation's text is cut at 10,000 characters and its width or height must be
  1–20,000 px. A malformed annotation is skipped with a reason, as is an edge that ends on a text, note or
  zone (only shapes take edges).
- Storage failures never crash anything: autosave writes return `false`, and the user gets one toast that says to
  export. Imports report "storage is full or blocked" and keep the previous copy.

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

### Mermaid (`src/interop/mermaid/`)

- **Export.** `flowchart LR|TB` with front-matter title, subgraphs, `-.->` for async and `-->` for sync,
  quoted labels (`label<br/>sublabel`), cylinders for data stores and stadiums for clients. A trailing
  `%% diagrams:{…}` comment keeps ids, stencils and tones; Mermaid ignores it. Shape annotations become
  Mermaid nodes of the same shape (`[]` `()` `(())` `{}` `[()]`) and keep their edges; text, notes and
  zones have no Mermaid equivalent and are left out.
- **Import.** The syntax above. Positions come from the editor's layered auto-layout (`src/editor/layout.ts`),
  with subgraph members kept adjacent in each layer and boundaries fitted around them. Stencils come from
  the metadata comment, then label keywords, then shape (a cylinder means a store).

### Share links and embeds (`src/interop/share.ts`, `src/interop/embed/`)

- `#d=<base64url(deflate-raw(JSON))>` lives in the URL _fragment_, which browsers never send to the server.
  So it never reaches server logs. A full example with two simulations is about 3k characters. The dialog
  warns above 8k.
- `?embed=1&example=<slug>` (public examples only) or `?embed=1#d=…` renders a read-only viewer: no top bar,
  fitted, pan and pinch-zoom only (the wheel scrolls the host page), no menus, shortcuts or autosave, and a
  subtle "Open in Diagrams" link. `live=1&sim=<id>` pass through for the live view.
- The embed dialog previews the iframe, and its options (source, height, simulation) sit behind **Options**.

### Local folders: Google Drive for desktop, OneDrive, Dropbox (no setup)

In Chrome or Edge, **Save** uses the File System Access API. Saving into a folder that Google Drive for desktop,
OneDrive or Dropbox syncs puts the diagram in the cloud with no OAuth at all, and Ctrl+S keeps writing to
that same file. After a reload, the browser asks once to allow editing again. In Firefox and Safari, Save
downloads the file and Open uses the standard file picker.

## Google Drive setup (owner, one time)

Drive is opt-in at build time. Until both variables are set, Drive items are hidden and no Google
script loads.

1. **Create a project.** Go to <https://console.cloud.google.com/>, then project picker → **New project**. Name it
   (e.g. `diagrams`) → **Create**, and select it. On the dashboard, note the **Project number** (digits, not the
   project id).
2. **Enable the APIs.** Go to **APIs & Services → Library**, then enable **Google Drive API** and **Google Picker API**.
3. **Set up the OAuth consent screen.** Go to **APIs & Services → OAuth consent screen** (in newer consoles: **Google Auth
   Platform → Branding / Audience / Data access**).
   - User type / Audience: **External**. Publishing status: **Testing**.
   - App name `Diagrams`, a support email, and a developer contact email. Optionally the logo, home page and privacy
     policy URLs (all required later for verification).
   - **Data access / Scopes**: **Add or remove scopes**, add `https://www.googleapis.com/auth/drive.file`
     ("See, edit, create, and delete only the specific Google Drive files you use with this app") → **Update** → Save.
   - **Test users / Audience**: add your own Google account (and anyone else who should try it). In Testing mode
     only these accounts can sign in. Tokens work normally, but each consent expires after 7 days.
4. **Create the OAuth client ID.** Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**, name `Diagrams web`.
   - **Authorized JavaScript origins** (no paths, no trailing slash):
     - `http://localhost:5173` (Vite's default dev port; add any other port you use, such as `http://localhost:5196`)
     - `https://www.latchkostov.com`
     - `https://latchkostov.com` (only if the bare domain also serves the site)
     - the future domain, e.g. `https://diagrams.example.com`
   - Leave **Authorized redirect URIs** empty. The token model uses a popup, not redirects.
   - **Create**, then copy the **Client ID** (`123456789012-….apps.googleusercontent.com`). There's no secret to keep.
5. **Create an API key.** Go to **Credentials → Create credentials → API key**, then **Edit API key**:
   - **Application restrictions: Websites** (HTTP referrers). Add `http://localhost:5173/*`, `https://www.latchkostov.com/*`
     and `https://<future-domain>/*`. Google's Picker guide also asks for **`https://docs.google.com/*`** (the Picker
     iframe makes requests from there); without it you get "The API developer key is invalid".
   - **API restrictions: Restrict key**, ticking only **Google Picker API**.
   - Save, then copy the key.
6. **Put the values in the build.**
   - Dev: copy `.env.example` to **`.env.local`** in the repo root and fill in `VITE_GOOGLE_CLIENT_ID`,
     `VITE_GOOGLE_API_KEY`, and optionally `VITE_GOOGLE_APP_ID` (the project number; it defaults to the client id
     prefix). Restart `pnpm dev`.
   - Production: Vite inlines `VITE_*` variables at **build time** into the static JS. Set the same variables in
     the environment that runs `pnpm build` (a CI secret or variable, or `.env.production.local` on the build
     machine), then deploy `dist/`. The values are visible in the shipped JS. That's expected: the client id is
     public by design, and the key is locked to the Picker API and your referrers.
   - Note: `.env.local` isn't in `.gitignore` yet; add `*.local` there (lead's file) so local values aren't committed.
7. **Try it.** Open the app from one of the authorized origins, then **File → Save to Google Drive** (a Google popup
   asks for consent once) and **File → Open from Google Drive**. Saved files are `*.diagram.json` in My Drive.
   **Save** (Ctrl+S) then updates that same file.

**Leaving Testing mode (so anyone can use it).** In the consent screen, choose **Publish app**. Because `drive.file`
is a _non-sensitive_ scope, there's no security assessment, but Google requires **brand verification**:

- a verified home page on a domain you own (verify it in Google Search Console)
- a publicly reachable privacy policy and terms on that domain
- an app name and logo that match the site
- authorized domains listed on the consent screen

Review usually takes a few business days. Until it's verified, users see an "unverified app" warning and
there's a cap of 100 users.

**Troubleshooting.** A blocked popup means: allow popups for the site. `idpiframe_initialization_failed` or
`origin_mismatch` means the page origin isn't in the client's JavaScript origins. "API developer key is invalid"
means a referrer is missing from the API key, often `https://docs.google.com/*`. A 403 on open means the file
wasn't picked through the Picker, or `appId` doesn't match the client's project.

## OneDrive and Dropbox

Neither is built. Each is doable without a backend, but the cost and benefit are poor next to the synced-folder
route above, which already covers both:

- **OneDrive / SharePoint (File Picker v8).** Register an app in Entra ID (SPA platform, redirect URI = site origin)
  and add MSAL.js (`@azure/msal-browser`, about 30 KB gzipped) for PKCE tokens with `Files.ReadWrite.AppFolder` or
  `Files.ReadWrite`. Then host the picker via its postMessage protocol (`https://onedrive.live.com/picker` for
  personal accounts, `https://<tenant>-my.sharepoint.com/_layouts/15/FilePicker.aspx` for work). Read and write go
  through Microsoft Graph (`/me/drive/items/{id}/content`, which supports CORS). Effort: about a day, plus testing
  separately for personal and work tenants.
- **Dropbox.** _Open_ is cheap: the Chooser drop-in (`dropins.js` with `data-app-key`, `linkType: "direct"`) returns
  a URL that we fetch. _Save_ isn't possible with the Saver, which needs a public URL rather than a blob. It needs
  the HTTP API with OAuth 2 PKCE (`/oauth2/authorize`, token endpoint, then `files/upload`). Effort: half a day for
  open-only, about a day with save.

## Files

| Path                                           | Purpose                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/interop/native.ts`                        | Validation, `migrate`, `preserveUnknown`, `serializeNative`                                       |
| `src/interop/formats.ts`                       | Format detection, `importText` (one entry point for every import)                                 |
| `src/interop/codec.ts`, `xml.ts`               | DEFLATE / base64url codecs; a dependency-free XML reader (Node has no DOMParser)                  |
| `src/interop/infer.ts`                         | Label keywords → stencil                                                                          |
| `src/interop/drawio/{read,write,mapping}.ts`   | draw.io converter plus fixtures in `drawio/fixtures/`                                             |
| `src/interop/mermaid/{read,write}.ts`          | Mermaid converter                                                                                 |
| `src/interop/share.ts`                         | Share-link and embed URL helpers                                                                  |
| `src/interop/gdrive/{config,client,google}.ts` | Env gating, pure REST client, GIS / Picker glue                                                   |
| `src/interop/files.ts`, `image.ts`, `icons.ts` | File System Access and downloads, PNG/SVG rendering, icon inlining                                |
| `src/interop/useInterop.tsx`                   | Controller: File menu actions, shortcuts, drag-and-drop, share-hash handling, canvas menu actions |
| `src/interop/ui/*`                             | File menu, dialogs, toasts (`notify`), drop overlay, glyphs                                       |
| `src/interop/embed/EmbedView.tsx`              | `?embed=1` viewer                                                                                 |
| `src/styles/interop.css`                       | Styles (prefixed `ix-`)                                                                           |
