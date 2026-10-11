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

| File menu               | Notes                                                                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Save** (Ctrl+S)       | Goes back to wherever the diagram came from or was last saved: the same device file (File System Access) or the same file in Google Drive, OneDrive or Dropbox. Otherwise it asks where to save (or downloads, in browsers without the API). Ctrl+Shift+S is "Save as". |
| **Open…** (Ctrl+O)      | `.diagram.json`, `.drawio`, `.xml`, `.drawio.svg`, `.mmd`. A draw.io file with several pages asks which page to open.                                                                                                                                                   |
| Open from ▸ / Save to ▸ | Only when at least one cloud provider is configured (see "Storage providers" below); otherwise hidden completely, and **Save as…** stays a plain row. Each lists **This device** first, then the configured providers. Save to ▸ always makes a new file.               |
| **Export PNG**          | 2×, whole diagram, independent of pan and zoom.                                                                                                                                                                                                                         |
| **Copy share link**     | One click; the toast's **Details** opens the dialog (length, warning above 8k characters, native Share).                                                                                                                                                                |
| More formats ▸          | Diagram file (`.diagram.json`, lossless, simulations included) · Image… (PNG or SVG; scale and transparent background behind **Options**) · draw.io · Copy as Mermaid · Mermaid file (`.mmd`) · Embed code… · Save as…                                                  |
| Import from ▸           | Paste text… (JSON, draw.io XML or Mermaid, auto-detected) · Share link…                                                                                                                                                                                                 |

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

### Google Drive (owner, one time)

1. **Create a project.** Go to <https://console.cloud.google.com/>, then project picker → **New project**. Name it
   (e.g. `diagrams`) → **Create**, and select it. On the dashboard, note the **Project number** (digits, not the
   project id).
2. **Enable the APIs.** **APIs & Services → Library**: enable **Google Drive API** and **Google Picker API**.
3. **Set up the consent screen.** **Google Auth Platform** (older consoles: **APIs & Services → OAuth consent screen**):
   - **Branding**: app name `Diagrams`, a support email, the logo, home page `https://www.livediagrams.dev`, privacy
     policy `https://www.livediagrams.dev/privacy.html`, and under **Authorized domains** add `livediagrams.dev`.
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

**Before strangers can use it.** In **Audience**, choose **Publish app**. `drive.file` is a _non-sensitive_ scope, so
there's no security assessment, but Google requires **brand verification**: the home page and privacy policy on a
domain you've verified in Google Search Console, an app name and logo that match the site, and the authorized
domain. Review usually takes a few business days. Until then users see an "unverified app" warning and there's a
cap of 100 users.

**Troubleshooting.** A blocked popup: allow pop-ups for the site. `origin_mismatch`: the page's origin isn't in the
client's JavaScript origins. "API developer key is invalid": a referrer is missing from the key, often
`https://docs.google.com/*`. A 403 on open: the file wasn't picked through the Picker, or `appId` isn't the project
number.

### OneDrive (owner, one time)

You need a Microsoft Entra tenant to register the app (a bare personal Microsoft account can no longer own app
registrations). If you don't have one, sign up for a free Azure account with your Microsoft account; that creates
a "Default Directory" tenant. The app still works with everyone's personal and work OneDrive.

1. Go to <https://entra.microsoft.com> → **Entra ID** (or **Identity**) → **App registrations** → **New registration**.
   - **Name**: `Diagrams`. Users see this name when they consent, and it names the folder created in their
     OneDrive (**Apps › Diagrams**), so pick it once.
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
4. **Branding & properties**: home page `https://www.livediagrams.dev`, **Privacy statement URL**
   `https://www.livediagrams.dev/privacy.html`, and optionally terms of service and a logo. **Save**.
5. **Overview** → copy the **Application (client) ID** (a GUID). There's no secret: don't create one under
   **Certificates & secrets**.
6. **Add to Vercel** (steps above): `VITE_ONEDRIVE_CLIENT_ID` = that GUID. Optional `VITE_ONEDRIVE_TENANT`:
   `common` (the default: personal and work accounts), `consumers` (personal only) or `organizations` (work only).
   Redeploy.
7. **Try it.** **File → Save to ▸ OneDrive**: a Microsoft popup signs you in and asks for consent once. The file
   appears in OneDrive under **Apps › Diagrams**. **File → Open from ▸ OneDrive** lists that folder.

**Before strangers can use it.** Personal Microsoft accounts can sign in straight away; the consent screen marks
the app "unverified". Many work or school tenants block users from consenting to apps by unverified publishers, so
those users see "Need admin approval" until their admin consents, or until you complete **publisher
verification**: join the Microsoft AI Cloud Partner Program (free) to get a Partner ID, verify `livediagrams.dev` as
a custom domain in your tenant (a DNS TXT record; it must match the domain of the partner account's email), then
add the Partner ID in **Branding & properties → Publisher verification**. Microsoft's app-folder guide says
`Files.ReadWrite.AppFolder` works for work or school OneDrive, but the permissions reference still lists it as
personal only: try it with a work account before announcing work support.

**Troubleshooting.** `AADSTS50011` (redirect URI mismatch) in the popup: that exact `…/auth.html` URI isn't
registered. `AADSTS9002326`: the redirect URI is under "Web", not "Single-page application". "Need admin approval":
see publisher verification above. A 403 from Graph: the file isn't in Apps › Diagrams (the app can't see anything
else).

### Dropbox (owner, one time)

1. Go to <https://www.dropbox.com/developers/apps> → **Create app**.
   - **Choose an API**: **Scoped access**.
   - **Choose the type of access**: **App folder** (Diagrams then sees only its own folder).
   - **Name**: must be unique across Dropbox, e.g. `livediagrams`. **Create app**.
2. **Settings** tab:
   - **App folder name**: `Diagrams` (the folder becomes **Apps › Diagrams** in users' Dropbox).
   - **OAuth 2 → Redirect URIs**: add `https://www.livediagrams.dev/auth.html` and `http://localhost:5173/auth.html`
     (Dropbox matches exactly, port included; add each dev port, and the bare domain if it serves the app).
   - **Allow public clients (Implicit Grant & PKCE)**: **Allow**.
   - Copy the **App key**. Never use or share the **App secret**; Diagrams doesn't need it.
3. **Permissions** tab: tick **files.metadata.read**, **files.content.read** and **files.content.write** →
   **Submit**. Set these before anyone links: users who linked earlier must approve again after a scope change.
4. **Branding** tab: app name and icon, description, website `https://www.livediagrams.dev` and privacy policy
   `https://www.livediagrams.dev/privacy.html`.
5. **Add to Vercel** (steps above): `VITE_DROPBOX_APP_KEY` = the app key. Redeploy.
6. **Try it.** **File → Save to ▸ Dropbox**: a Dropbox popup asks to allow access once. The file appears in
   **Apps › Diagrams**. **File → Open from ▸ Dropbox** lists that folder.

**Before strangers can use it.** A new app is in **Development** status: it works for anyone, up to 500 linked
users. Once 50 users have linked it, you have two weeks to get **production** approval (**Settings → Production
status → Apply for production**), or it stops accepting new users. Dropbox reviews the branding, privacy policy
and how the app uses the API, usually within a few business days.

**Troubleshooting.** "Invalid redirect_uri" in the popup: that exact `…/auth.html` URI (with its port) isn't
listed. "Invalid client_id": wrong app key. `missing_scope`: tick the scopes under **Permissions**, then sign in
again.

## Files

| Path                                                       | Purpose                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/interop/native.ts`                                    | Validation, `migrate`, `preserveUnknown`, `serializeNative`                                       |
| `src/interop/formats.ts`                                   | Format detection, `importText` (one entry point for every import)                                 |
| `src/interop/codec.ts`, `xml.ts`                           | DEFLATE / base64url codecs; a dependency-free XML reader (Node has no DOMParser)                  |
| `src/interop/infer.ts`                                     | Label keywords → stencil                                                                          |
| `src/interop/drawio/{read,write,mapping}.ts`               | draw.io converter plus fixtures in `drawio/fixtures/`                                             |
| `src/interop/mermaid/{read,write}.ts`                      | Mermaid converter                                                                                 |
| `src/interop/share.ts`                                     | Share-link and embed URL helpers                                                                  |
| `src/interop/gdrive/{config,client,google}.ts`             | Env gating, pure REST client, GIS / Picker glue                                                   |
| `src/interop/storage/types.ts`, `registry.ts`, `config.ts` | The `StorageProvider` interface; which providers this build offers (env-gated, lazy)              |
| `src/interop/storage/{device,gdrive,onedrive,dropbox}.ts`  | The providers; OneDrive and Dropbox include their REST clients                                    |
| `src/interop/storage/oauth.ts`, `http.ts`                  | PKCE popup sign-in, in-memory tokens; authorised fetch, capped reads                              |
| `src/interop/storage/testProvider.ts`                      | Dev-only fake provider for e2e (`?storage=test`)                                                  |
| `public/auth.html`, `public/privacy.html`                  | OAuth redirect page; the privacy policy                                                           |
| `src/interop/files.ts`, `image.ts`, `icons.ts`             | File System Access and downloads, PNG/SVG rendering, icon inlining                                |
| `src/interop/useInterop.tsx`                               | Controller: File menu actions, shortcuts, drag-and-drop, share-hash handling, canvas menu actions |
| `src/interop/ui/*`                                         | File menu, dialogs, toasts (`notify`), drop overlay, glyphs                                       |
| `src/interop/embed/EmbedView.tsx`                          | `?embed=1` viewer                                                                                 |
| `src/styles/interop.css`                                   | Styles (prefixed `ix-`)                                                                           |
