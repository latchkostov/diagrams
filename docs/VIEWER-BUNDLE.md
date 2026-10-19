## Static viewer for app platforms

`pnpm build:viewer-bundle` produces `dist-viewer/`. Host the complete directory over HTTPS,
including its relative `assets/` paths. It works under a directory prefix. Runtime JavaScript,
CSS and the two Latin font files have content hashes; `manifest.json` identifies the entry for
platform packaging. A successful rebuild removes old hashes. Identical sources produce identical
files, independent of deployment settings. `pnpm size` builds and checks the viewer's combined
JavaScript, CSS and fonts against a 805 kB gzip budget, alongside the existing app entry budget.

This is the foundation for Forge, SPFx, Obsidian and Backstage adapters. It includes no platform
manifest, account integration, attachment transport or backend. Hosts supply diagram data with
their own authorized bridge. No diagram goes into a URL, persistent store or outbound link.

The bundle shares its read-only canvas, validation, live driver and content-height measurement
with the existing `<live-diagram>` web component. The Interactive HTML export's build restrictions
also apply: no editing panels, AI, storage providers, architecture checks or worker assets.
The original single-file Interactive HTML export remains available separately.

## Host adapter

After the external entry module evaluates, `window.liveDiagramsViewer` is available. Add a host
bootstrap as another **external** module, importing the hashed entry from the manifest at packaging
time. Register listeners before loading the first diagram. For example, an external `host.js`:

```js
import "./assets/viewer-<hash>.js";
import diagram from "./diagram.js"; // Host-supplied module exporting a diagram object.

const viewer = window.liveDiagramsViewer;
viewer.on("loaded", ({ title, nodes, simulations }) => {
  // Update the host's accessible title or simulation choices.
});
viewer.on("error", ({ code, message }) => {
  // Show a host error; the last valid diagram remains on screen.
});
viewer.on("size", ({ height }) => {
  // Ask the platform bridge to set the container height (CSS pixels).
});
viewer.load(diagram);
// In the host's reader-activated Play handler:
// viewer.play();          // Free play, or resume the current run.
// viewer.play("flow");    // Select a saved simulation and play it.
// viewer.stop();          // Pause; play() resumes from here.
```

- `load(diagram): boolean` accepts a diagram object or JSON text. It validates the format and the
  8 MB JSON limit before replacing the canvas. Returns `true` and emits `loaded` on acceptance;
  returns `false` and emits `error` on rejection. Every accepted load resets playback to off,
  even if the file has saved simulations. `loaded` means validated and accepted; painting and
  node measurement follow asynchronously.
- `play(simulationId?): void` is an explicit host action. An unknown simulation emits
  `unknown_simulation` without starting playback. Commands received while the canvas/session
  starts are applied in order. A new accepted load discards pending commands for the old diagram.
- `stop(): void` pauses playback, including a queued play. It preserves the playback position.
- `on(event, listener): () => void` subscribes to `loaded`, `error` or `size` and returns an
  unsubscribe function. Loaded details include `title`, `nodes` and `{ id, title }[]` simulations;
  errors include `code` and `message`; size details contain `height`.
- `dispose(): void` releases adapter subscriptions. The entry disposes it on page teardown.

Loading never autoplays. The viewer's existing Live button starts playback, including diagrams
without saved simulations. Hosts must call `play` only after a reader action. There is no autoplay
option. Settings use an in-memory storage facade installed before app modules evaluate; IndexedDB
and workers are unused. The bundle is a dedicated document, not a script to inject into an editor's
window, because its storage facade belongs to that document.

## Content Security Policy

The generated document includes this policy, also exercised as an HTTP response header in Playwright:

```text
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'
```

Scripts and stylesheets are external files. React Flow needs inline style attributes; no script
uses inline execution or eval. Fonts load from files, never data URIs. Stencil SVG images are
embedded data images. A future platform adapter must declare its own bridge/attachment permissions
and review any policy extension. This build does not grant network access to fetch attachments.

## Verification

`src/export/viewer/adapter.test.ts` covers validation, explicit playback, command ordering, errors,
reload reset and subscriptions. `src/export/viewerBundle.build.test.ts` checks deterministic hashed
assets, font files and worker exclusion. `tests/e2e/viewer-bundle.spec.ts` serves the production bundle
under the policy above, denies real persistent storage and worker APIs, and verifies rendering,
click-to-play with/without saved simulations, host playback, auto-height, fonts and zero CSP violations.
The production E2E build prepares this artifact before browser workers start; run with
`E2E_TARGET=build`. The existing Lab text-fields fixture supplies its generic diagram.
