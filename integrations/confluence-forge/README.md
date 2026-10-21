# Live Diagram for Confluence Cloud

A free Forge app: view and play a page attachment, with no editor, backend, outbound link, analytics
or external egress. The app is registered as **Live Diagram** and has been deployed and installed
in development. Nothing in this checkout needs an Atlassian account to build or test offline.
Public documentation: [Live Diagram for Confluence](https://www.livediagrams.dev/confluence.html).

## Development installation

1. Create an Atlassian account and a **Confluence development site** at
   [go.atlassian.com/cloud-dev](https://go.atlassian.com/cloud-dev). Complete the setup wizard and
   note its hostname, such as `your-dev-site.atlassian.net`.
2. Create an API token in your account's
   [API token settings](https://id.atlassian.com/manage-profile/security/api-tokens), following
   [Forge's current token instructions](https://developer.atlassian.com/platform/forge/getting-started/).
   The current CLI uses a **scoped** token; select the Forge scopes listed by those instructions.
   Keep it in your credential store, never in this repository or the manifest.
3. From the repository root, use Node 24 (`fnm use 24`) and the pinned pnpm:

   ```sh
   pnpm install --frozen-lockfile
   pnpm --filter @livediagrams/confluence-forge build
   npm i -g @forge/cli
   cd integrations/confluence-forge
   forge login
   forge deploy --environment development
   forge install --environment development
   ```

   `forge login` prompts for your Atlassian account and token. The registered app is **Live Diagram**.
   Keep the existing `app.id` in `manifest.yml`; do not register a second app. In `forge install`,
   choose **Confluence** and the dev-site hostname. Accept the attachment read/file upload scopes.
   Keep sharing disabled for development; production distribution is a separate step below.

4. Create and **publish** a Confluence page first. Save a Diagram file from Live Diagrams
   (**File ▸ Save diagram file**). Native `.diagram.json` and older `.livediagram.json` files work;
   renaming a PNG or Interactive HTML file won't work.
5. Edit the page and insert **Live Diagram** from the `/` macro picker. Choose or drop the file,
   check its still preview, then click **Insert**. **Options** holds Free play or a saved simulation,
   Auto size or Small (480 px), Medium (640 px), Large (800 px), and Follow Confluence, Light or Dark.
   Files stay in memory until Insert. A same-name page attachment gets a new version. When editing,
   **Replace file** stages a replacement and **Update** adds a version of the current attachment,
   keeping its ID and filename. Cancel discards the staged file and settings. If uploading succeeds
   but saving settings fails, the alert explains that Cancel retains the uploaded version; restore
   the previous version from the page's attachment history if needed. Retry reuses that upload,
   including after an invalid replacement is rejected. Publish the page.
6. The macro opens as a still diagram. Press **Play diagram** (also accessible by Tab and Enter/Space).
   Page and attachment permissions apply to every reader. To edit, download the attachment using
   Confluence, edit the file outside this macro, then use **Replace file**, then **Update** in config.
   Replacement preserves the selected attachment ID and filename and creates another version.
   Use **Maximise** to open a larger view in a Forge Modal without leaving Confluence.
   Choosing or replacing a file never uploads it; Insert/Update commits it. Previous versions remain
   in Confluence's attachment history. The macro reads the latest version, rather than pinning one.

For subsequent updates, rebuild from the repository root and run `forge deploy --environment development`
inside this directory. After a permission change, run `forge install --upgrade --environment development`.
An app built here is designed for zero egress and Runs on Atlassian eligibility; the badge is determined
by Atlassian after registration/deployment, not certified by this offline spike.

**Auto size** fits the measured diagram to the available column width, including margins and
viewer controls, with a 480 px minimum and 900 px maximum. The minimum keeps a small diagram readable;
the maximum prevents a tall diagram from taking over a page. Fixed heights are unchanged. With the
macro's `viewportSize` omitted, Forge automatically resizes the iframe to its document content; bridge
7.2 has no `view.resize` API. Repeated size reports do not rewrite the height.

**Maximise diagram** opens the same resource in a Forge `Modal` of size `max`, still until **Play diagram**.
It passes only the attachment reference and settings, and reads the attachment through the current user's
bridge again. Inline playback pauses when opening and stays paused until explicitly resumed.
Esc closes an inner menu, panel or dialog first; with none open it closes Maximise.
Press **Close diagram** to close directly; focus returns
to Maximise. This uses the [Custom UI Modal API](https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/modal/),
which is supported by the pinned bridge 7.2.0, instead of the iframe-blocked browser Fullscreen API.

The [macro manifest](https://developer.atlassian.com/platform/forge/manifest-reference/modules/macro/)
supports `layout: block` (the default), `inline` or `bodied`; it has no `wide` or `full-width` layout value.
Keep the default block layout. Choose a wider Confluence page/column where available, or use Maximise.

## Real-site release checklist

The owner reports that the development installation works. This checklist remains a release check,
not a claim that every case has been verified. Filename compatibility, Forge Modal maximise and
readable automatic height shipped in #218; the instructions
and Marketplace package describe that release.

- [ ] `forge lint`, deploy and installation succeed with the existing app ID and two declared scopes.
- [ ] On a published page, choose or drop `.diagram.json` and older `.livediagram.json` files.
      Preview appears without uploading; Cancel closes without writes, including after an error.
- [ ] **Critical spike:** `requestConfluence` returns attachment JSON after the REST download redirect.
      Test a normal file and one near the 8 MB limit. No browser `fetch`, external URL permission or
      resolver fallback has been added. If the bridge cannot deliver bytes, retain the honest error
      and capture endpoint/status (no diagram content) for a follow-up Atlassian-hosted resolver.
- [ ] Insert uploads once; a same-name file adds a version. Replace file then Update keeps the same
      attachment ID and creates version 2 with the original
      filename, even when the local filename differs. Restore version 1 in Confluence attachment history.
- [ ] A reader with page access can view/play but cannot upload without edit/attachment permission.
      A restricted reader or blocked app gets an honest error. Revoking access then reloading reveals
      no cached diagram. No app-level credentials bypass page permissions.
- [ ] Reload remains still for at least ten seconds; Play starts Free play/the selected saved simulation.
      Tab, Enter and Space work. A missing simulation asks the editor to choose again.
- [ ] Automatic height fits the host column without a resize loop; fixed height stays fixed. Try narrow
      columns and several macros. Confluence light/dark changes follow live, explicit themes stay fixed.
- [ ] Maximise opens a large, still viewer with the same simulation and theme. Esc and Close diagram
      close it; focus returns to Maximise. No browser Fullscreen, download or outbound app links appear.
- [ ] Browser Network shows only static resource assets and Atlassian bridge/product operations;
      no requests go to Live Diagrams or any other outside service. No CSP errors, inline scripts,
      data fonts, worker construction or outbound links appear.
- [ ] Page editing, publish/reopen, page copy/move and live docs are checked. Copied attachment references
      may need reselecting if Confluence assigns new IDs. This spike does not promise PDF/Word exports.
- [ ] Inspect macro configuration: only `attachmentId`, `simulation`, `height`, `theme`; no diagram JSON.

## Offline development and CI

From the repository root:

```sh
pnpm --filter @livediagrams/confluence-forge build
pnpm --filter @livediagrams/confluence-forge lint:manifest
pnpm test src/lib/confluenceForge.test.ts
pnpm gate quick tests/e2e/confluence-forge.spec.ts --workers 2 --max-wait 1
```

The package uses the repository's pinned Node/Vite/TypeScript toolchain and workspace lockfile. It
does not install or invoke the Forge CLI. `check.mjs` is a hand-written offline contract lint for the
exact manifest fields relied on here, not a replacement for Atlassian's deployment validation.
The build runs it and checks the **combined** view/config resources against 5 MB raw and 1.02 MB gzip
(885 kB measured, around 15% gzip headroom). Root `pnpm size` includes this build; root `pnpm typecheck`
includes this package. Root Vitest and Playwright discover its tests in CI.

Playwright builds the deployable resources with the real `@forge/bridge`, plus a separate fake-bridge
build in `tests/.output/confluence-forge`. The deployable directory can never be the fake build target.
Both run under the existing viewer's Forge-like CSP; no account, site, token or CLI login is used.
The real SDK test fakes the product transport. This verifies SDK serialization and CSP compatibility,
but cannot prove Confluence's permission checks, attachment redirects or multipart handling on a site.

The reusable viewer is packaged unchanged except for suppressing its outbound React Flow attribution
link in this integration build. Zoom, Fit, Live and simulation controls work locally; the Forge host
supplies Maximise and Close. The toolbar has no native diagram download or Open in Live Diagrams control.
Existing recording and sequence exports stay local, with no egress. Forge's default iframe permissions
allow user-initiated downloads and clipboard writes. The default
viewer and main app keep their existing behavior. Runtime
diagram content stays in memory and moves only through the reader's Forge bridge to/from Confluence.
No Forge functions, app storage, `asApp`, remotes, external fetch permissions or runtime dependencies on
the public website are used. React Flow's styles require `permissions.content.styles: unsafe-inline`;
scripts remain `self`, fonts are files and workers are disabled. With no macro `viewportSize`, Forge
auto-resizes to the document's bounded viewer height.

## API contracts and deferred work

The implementation uses [Custom UI custom configuration](https://developer.atlassian.com/platform/forge/add-custom-configuration-to-a-macro/?tab=custom+ui&tabId=2),
[`requestConfluence` as the current user](https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/requestConfluence/),
[v2 page attachment listing](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-attachment/),
and [v1 attachment download/upload/replacement](https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content---attachments/).
The read scope covers listing/download; the recommended narrow classic `write:confluence-file` scope
covers creating/replacing files without granting page-body edits or attachment deletion.
[Theming](https://developer.atlassian.com/platform/forge/design-tokens-and-theming/) follows bridge-injected
`data-color-mode`, with a light fallback where unavailable.

Deferred: resolver fallback until a real-site failure demonstrates need; export previews and `adfExport`;
editor; Jira; approved Marketplace install link; coordination among multiple macros and offscreen playback.
No PNG fallback is claimed because v1 stores only the Diagram attachment.

## Publishing to the Marketplace

The owner creates the partner profile and submits the listing. The orchestrator runs the production
deploy. No production deploy or Marketplace submission is performed by preparing these files.
Follow Atlassian's [Forge listing guide](https://developer.atlassian.com/platform/marketplace/listing-forge-apps/)
and [distribution guide](https://developer.atlassian.com/platform/forge/distribute-your-apps/).

1. **Owner: create the Marketplace partner profile** with display name **Live Diagrams**. Use the
   partner description and URLs in [marketplace/listing.md](marketplace/listing.md). Choose **Free**
   pricing. Support is public GitHub issues, with no personal email in public copy.
2. **Orchestrator: build and deploy production** after the companion pilot-feedback fixes land and
   the real-site checklist above passes. From the repository root:

   ```sh
   fnm use 24
   pnpm install --frozen-lockfile
   pnpm --filter @livediagrams/confluence-forge build
   cd integrations/confluence-forge
   forge lint
   forge deploy --environment production
   ```

   Keep the registered app ID. Do not enable paid licensing or introduce egress. Verify production
   Runs on Atlassian eligibility with the current Forge CLI before claiming a badge.

3. **Owner: enable distribution in the Developer Console.** Select the registered **Live Diagram**
   app, open **Distribution**, enable sharing and set Confluence as the supported product. Set:
   privacy `https://www.livediagrams.dev/privacy.html#confluence`, terms
   `https://www.livediagrams.dev/terms.html`, support
   `https://github.com/latchkostov/diagrams/issues/new?template=confluence-app.yml`, and documentation
   `https://www.livediagrams.dev/confluence.html`. Verify these pages are live after the site change
   is deployed; a branch push alone does not publish them.
4. **Owner: create the free listing** from [marketplace/listing.md](marketplace/listing.md), linking
   the production Forge app to the **Live Diagrams** partner. Copy each field without its heading.
   Use Confluence Cloud compatibility only. Do not enable a trial or paid licensing.
5. **Owner: complete Privacy & Security and the Forge security questionnaire** from
   [marketplace/security-privacy.md](marketplace/security-privacy.md). Confirm the marked legal,
   scanning, incident-response and organisation-contact answers; do not submit those as verified
   facts from source code. If Atlassian requires a security email, provide an organisation-managed
   contact directly in its form, rather than publishing a personal address or inventing a mailbox.
6. **Owner/orchestrator: upload artwork and screenshots.** Use `marketplace/logo-144.png` and
   `marketplace/banner-1120.png`. Capture the five shots in
   [marketplace/screenshots.md](marketplace/screenshots.md), including the three 580 × 330 highlight
   crops, using only invented generic diagrams. Do not upload the banner in place of a product screenshot.
7. **Owner: preview and submit** the listing for Atlassian review. Check field lengths, public links,
   free pricing, screenshots and the production version. Create the public `confluence` issue label
   if it does not exist, so the issue form can apply it. After approval, replace “coming soon” in
   `public/confluence.html` with the approved Marketplace install link and verify it on the site.
