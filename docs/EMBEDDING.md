# Embedding: your app supplies the diagram

Live Diagrams has three ways to put a diagram in someone else's page:

| Embed                            | Where the diagram is                                        | Use it for                                   |
| -------------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| `?embed=1&example=<slug>`        | A public example, by name                                   | Blog posts about the examples                |
| `?embed=1#d=…` (or `#e=…`)       | Inside the iframe's URL (compressed, or password-encrypted) | Public diagrams in docs, wikis and blogs     |
| **`?embed=1&host=1`** (this doc) | **In your page only**, handed to the viewer at run time     | Company diagrams behind your app's own login |

With a host-supplied embed, your page fetches the diagram from your own server (with your own cookies and
sign-in) and gives it to the viewer frame with `postMessage`. The diagram is never in a URL, never in the browser's
storage and never sent to livediagrams.dev, which only serves the viewer's code. In the app it's **File ▸ Share… ▸
Embed in your app…**, listed with the private ways out; Private diagrams can be embedded this way, and only this way.
The other two put the whole diagram in the page's code, so anyone who can see the page can open it: they're **Share…
▸ Embed on a public page…**, folded with the share link under **Public link or embed**.

Code: the frame is `src/interop/embed/HostEmbedView.tsx` (its rules in `hostProtocol.ts` and `hostReducer.ts`), the
web component is `public/embed/live-diagram.js`, and the Embed dialog's snippets come from `hostSnippets.ts`.

## Quick start: the web component

```html
<script type="module" src="https://www.livediagrams.dev/embed/live-diagram.js"></script>

<live-diagram src-json="/api/diagrams/orders.diagram.json" simulation="black-friday" autoplay></live-diagram>
```

`src-json` is fetched by **your** page, from your server: same-origin by default, with your cookies, so your access
control applies (add `credentials="include"` for a cross-origin API that expects them). Save the file from the app
with **File ▸ Export as ▸ Diagram file**, or the Embed dialog's **Diagram file** button.

Or give it the diagram yourself:

```js
const el = document.querySelector("live-diagram");
el.diagram = await (await fetch("/api/diagrams/orders.diagram.json")).json();
// or, to know when it's shown (or why not):
await el.load(diagram, { theme: "dark", simulation: "black-friday", autoplay: true });
```

### Attributes

| Attribute     | Meaning                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `src-json`    | URL of the diagram file, fetched by your page (read up to 8 MB, then cancelled). Changing it loads the new one. |
| `credentials` | `include` to send cookies to a cross-origin `src-json`. Default `same-origin`.                                  |
| `theme`       | `light` or `dark`. Default: the viewer's system setting. Changing it applies at once.                           |
| `simulation`  | A saved simulation's id to show in live view. Changing it switches (and plays).                                 |
| `autoplay`    | Start playing at once (the simulation, or free-play traffic).                                                   |
| `speed`       | `0.25`, `0.5`, `1`, `2`, `4` or `8`.                                                                            |
| `fit`         | `false` keeps the view where the reader left it when the frame resizes. Default: refit.                         |
| `height`      | A fixed height in px. Without it the element sizes itself to the diagram (auto-height).                         |
| `title`       | The iframe's accessible name. Default "Diagram".                                                                |
| `loading`     | `lazy` to load the viewer only when it nears the screen.                                                        |

### Methods and properties

| Member                    | Does                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `diagram` (get / set)     | The diagram shown (object or JSON text). Setting it loads it.                                                                                                            |
| `load(diagram, options?)` | Loads a diagram, replacing any still loading (a `src-json` fetch included); resolves with the `loaded` details, rejects with an `Error` with `code`. Every call settles. |
| `play()`, `pause()`       | Play or pause live view (going live first if needed).                                                                                                                    |
| `setSpeed(speed)`         | One of the speeds above.                                                                                                                                                 |
| `selectSimulation(id)`    | A saved simulation's id, or `null` for free play. It starts playing.                                                                                                     |
| `fit()`                   | The whole diagram in view.                                                                                                                                               |
| `setTheme(theme)`         | `"light"` or `"dark"`.                                                                                                                                                   |
| `highlight(nodeIds)`      | Rings these nodes (unknown ids are ignored); `[]` clears.                                                                                                                |

### Events

`CustomEvent`s on the element, `detail` as in the protocol below (lower-case names, not bubbling):
`ready`, `loaded`, `error`, `nodeclick`, `simulationchanged`, `playstate`, `resize`.

```js
el.addEventListener("nodeclick", (e) => openRunbook(e.detail.nodeId));
el.addEventListener("error", (e) => console.warn(e.detail.code, e.detail.message));
```

The element's iframe is in its shadow root, exposed as `::part(frame)` for styling and with
`data-testid="live-diagram-frame"` for your UI tests. Style the element itself (`border-radius`, `box-shadow`,
`max-width`) like any block.

### React

No package needed: a wrapper is a few lines.

```tsx
import { useEffect, useRef } from "react";

// Once, anywhere: import("https://www.livediagrams.dev/embed/live-diagram.js") or the <script type="module"> tag.

export function LiveDiagram({
  diagram,
  simulation,
  onNodeClick,
}: {
  diagram: object;
  simulation?: string;
  onNodeClick?: (nodeId: string, label: string) => void;
}) {
  const ref = useRef<HTMLElement & { load(d: object, o?: object): Promise<unknown> }>(null);
  useEffect(() => {
    // The element's methods exist once the script has defined it.
    void customElements
      .whenDefined("live-diagram")
      .then(() => ref.current?.load(diagram, { simulation, autoplay: !!simulation }))
      .catch(console.warn);
  }, [diagram, simulation]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onNodeClick) return;
    const on = (e: Event) => {
      const { nodeId, label } = (e as CustomEvent<{ nodeId: string; label: string }>).detail;
      onNodeClick(nodeId, label);
    };
    el.addEventListener("nodeclick", on);
    return () => el.removeEventListener("nodeclick", on);
  }, [onNodeClick]);
  return <live-diagram ref={ref} />;
}

// TypeScript: declare the element once.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "live-diagram": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        "src-json"?: string;
        simulation?: string;
        autoplay?: boolean;
        theme?: "light" | "dark";
      };
    }
  }
}
```

An npm package (`@livediagrams/embed`) would only wrap the same file; it isn't published. Load the script from the
site, which keeps every page on the current protocol.

## Without the web component: iframe and postMessage

```html
<iframe
  id="orders-diagram"
  title="Order flow"
  width="100%"
  height="480"
  style="border:0"
  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
></iframe>
<script type="module">
  const VIEWER = "https://www.livediagrams.dev";
  const PROTOCOL = "livediagrams.embed.v1";
  const frame = document.getElementById("orders-diagram");
  // Your page's origin goes in the URL: the viewer only talks to it. The diagram never does.
  frame.src = `${VIEWER}/?embed=1&host=1&hostOrigin=${encodeURIComponent(location.origin)}`;
  window.addEventListener("message", async (event) => {
    if (event.source !== frame.contentWindow || event.origin !== VIEWER) return;
    const msg = event.data;
    if (msg?.protocol !== PROTOCOL) return;
    if (msg.type === "ready") {
      const diagram = await (await fetch("/api/diagrams/orders.diagram.json")).json();
      frame.contentWindow.postMessage(
        { protocol: PROTOCOL, type: "load", diagram, options: { simulation: "black-friday", autoplay: true } },
        VIEWER,
      );
    } else if (msg.type === "resize") {
      frame.style.height = `${msg.height}px`;
    }
  });
</script>
```

Attach the `message` listener before setting `src`, so `ready` can't arrive first. **Share… ▸ Embed in your app… ▸
iframe + postMessage** writes this for your diagram.

## Protocol reference (`livediagrams.embed.v1`)

Every message, both ways, is a plain object with `protocol: "livediagrams.embed.v1"` and a `type`. Messages with
another `protocol`, or a `type` the frame doesn't know, are ignored without a reply, so a newer page keeps working
with an older viewer. An incompatible change gets a new protocol name.

### Page → viewer

```ts
type Speed = 0.25 | 0.5 | 1 | 2 | 4 | 8;

interface LoadOptions {
  theme?: "light" | "dark"; // default: the viewer's system setting (or the last setTheme)
  simulation?: string | null; // a saved simulation's id to show in live view
  autoplay?: boolean; // start playing at once (default false)
  speed?: Speed; // default 1
  fit?: boolean; // refit the whole diagram when the frame resizes (default true)
}

type HostMessage = { protocol: "livediagrams.embed.v1"; id?: string } & (
  | { type: "load"; diagram: object | string; options?: LoadOptions } // replaces the diagram
  | { type: "play" }
  | { type: "pause" }
  | { type: "setSpeed"; speed: Speed }
  | { type: "selectSimulation"; simulation: string | null } // null: free play; it plays
  | { type: "fit" }
  | { type: "setTheme"; theme: "light" | "dark" }
  | { type: "highlight"; nodeIds: string[] } // [] clears
);
```

`id` (1 to 200 characters) is echoed in the reply to that message: `loaded` or `error`. Every message with an `id`
gets one of the two, even when it's refused by the rate limit. Every command except `setTheme` needs a diagram first
(`not_loaded`). Commands may come right after `loaded`, before live view is up (its code may still be downloading):
they wait and run in order. `play` and `selectSimulation` turn live view on when it's off; a `pause` waits too
when a session is on its way (after `play`, a switch or an autoplay load), so "autoplay, then pause" ends paused.
With live view off and nothing starting it, `pause` does nothing.

### Viewer → page

```ts
type FrameMessage = { protocol: "livediagrams.embed.v1" } & (
  | { type: "ready"; version: 1 } // send `load` now (sent once the viewer listens)
  | { type: "loaded"; id?: string; title: string; nodes: number; simulations: { id: string; title: string }[] }
  | { type: "error"; id?: string; code: ErrorCode; message: string }
  | { type: "nodeClick"; nodeId: string; label: string }
  | { type: "simulationChanged"; simulation: string | null } // null: free play
  | { type: "playState"; playing: boolean; speed: number }
  | { type: "resize"; height: number } // the height that shows the whole diagram at the frame's width
);

type ErrorCode =
  | "invalid_message" // a known type with a bad field (the message says which)
  | "too_large" // the diagram is over 8 MB of JSON
  | "invalid_diagram" // not JSON, or not a diagrams/v1 file (the validator's reason)
  | "not_loaded" // a command before the first good load
  | "unknown_simulation" // no simulation with that id
  | "rate_limited"; // too many messages (always to a message with an id, else at most once a second)
```

A failed `load` leaves the diagram on screen as it was. The web component adds codes of its own, on its `error`
event or a `load()` rejection:

- `fetch_failed`: `src-json` couldn't be fetched;
- `too_large` and `invalid_diagram` before anything is sent: a string over 8 MB, an object whose JSON would be (it's
  measured by walking it, so shared references that JSON would repeat can't blow up memory), a `src-json` response
  past 8 MB (the download is cancelled there), or nesting deeper than the validator allows;
- `superseded`: a newer `load()` (or diagram) replaced this one before it was sent;
- `timeout`: the viewer didn't answer within a minute of the load being sent;
- `disconnected`: the element was removed from the page;
- `no_origin`: a `file://` or sandboxed page has no origin to name.

`nodeClick` fires for a click on a node (not the end of a drag) and for Enter or Space on a focused node: nodes are
Tab stops in the viewer, so whatever your page does with it works from the keyboard too.

### Auto-height

`resize` reports the frame height that shows the whole diagram at the frame's current width: the diagram's height at
the zoom that fits its width (at most 125%), plus the title card and the live bar, at least 200 px (380 while live, so the narration has room) and at most 1600 px. It
depends only on the width, so setting the iframe to it never loops. It's sent once the diagram is measured, and again
when the width changes or live view turns on or off. The web component applies it unless `height` is set; with raw
iframes, set `frame.style.height` yourself (or cap it with CSS `max-height`). When the frame resizes, the viewer
refits the whole diagram (unless `fit: false`).

### Limits

- The diagram: 8,000,000 characters of JSON (measured before parsing; an object is walked and measured before it's
  serialised, so a clone whose shared references would expand into a huge JSON is refused early), then the
  app's own validator, with the same limits as opening a file (5,000 nodes, 20,000 edges, nesting depth and the
  simulation budgets).
- Ids (`id`, simulation ids, node ids): 1 to 200 characters; `highlight` takes at most 5,000 ids.
- Rate: 60 messages at once, then 30 a second; `load`, 5 at once, then one every 2 seconds. Over the limit, a
  message with an `id` is answered `rate_limited` (so a `load()` promise always settles); others are dropped, with one
  `rate_limited` error a second at most.

## Security model

What it protects: a diagram that must not leave the host app. The threats: it ending up in a URL (logs, history,
referrers, chat previews), in storage, on our servers or with a third party; another page driving the viewer or
reading its events; the viewer harming the host page.

- **The diagram is never in a URL or a request.** The viewer's URL holds `embed`, `host` and `hostOrigin`, nothing
  else, and the viewer never fetches the diagram: the host page does, then posts it. The frame keeps it in memory
  only (not in `localStorage`, `sessionStorage` or IndexedDB) and marks it private (`"private": true`), so no
  share link, no embed code and no "Open in Live Diagrams" copy is ever made from it. The only link out is a plain
  "Made with Live Diagrams" to the site. Embeds have no AI panel and no WebMCP tools. No embed writes to this site's
  storage at all: it reads the person's saved theme, and a theme the host sets (or a panel folded) lasts as long as
  the frame, in memory (`stopStorageWrites` in `src/lib/storage.ts`). The frame's CSP allows
  this site only (`script-src`, `connect-src` and `frame-src 'self'`): no storage provider's script, frame or endpoint,
  none of which an embed uses.
- **`hostOrigin` locks the origin, from the URL, for the whole session.** We chose the URL parameter over "the first
  valid `load` locks it":
  - the viewer can announce `ready` to an exact origin: it never needs `postMessage(…, "*")`, not even once;
  - the very first message is already checked, so there's no race over who sends the first `load`;
  - it doesn't depend on `document.referrer` (a `no-referrer` host strips it) or `location.ancestorOrigins` (not in
    Firefox);
  - it costs the host nothing: the web component fills it in from `location.origin`.
- **Serve the host page over https when you can.** `http://` host origins are accepted (some intranets have nothing
  else), but a page served over plain http can be changed on the network on its way to the reader, and the viewer
  trusts whatever that page hands it.

  It must be a plain `http(s)` origin (no path, query, credentials or wildcard); without one the viewer explains
  what's missing and does nothing.

- **Only the parent, only at that origin.** A message is read only if `event.source === window.parent` (not a
  sibling frame, a pop-up or the frame itself) and `event.origin === hostOrigin`; anything else is dropped without a
  reply. A page that frames the viewer naming someone else's origin hears nothing: every reply goes to that other
  origin, so the browser drops it.
- **Replies go only to `hostOrigin`.** Every `postMessage` from the viewer targets `hostOrigin`, and the web component
  targets the viewer's origin; neither ever uses `"*"`. Events carry only what the host already has (node ids and
  labels from its own diagram, simulation ids, heights).
- **Nothing is evaluated.** Messages are plain data, read field by field with type and size checks; the diagram goes
  through `JSON.parse` and the app's validator, never `eval` or `new Function`. Unknown types are ignored.
- **Size and rate bounds** (above) keep a misbehaving page from tying up the viewer.
- **The host page stays in charge.** The web component's iframe is sandboxed
  (`allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox`): the viewer can't navigate the host
  page, open dialogs on it or submit forms. It listens only to its own iframe (`event.source`) at the viewer's origin.

### The host page's Content-Security-Policy

The web component runs in your page, under your policy. It uses no `eval`, no inline scripts and no inline styles (its
one stylesheet is a constructed `CSSStyleSheet`; sizes are set through the CSSOM), so a strict policy works with two
additions:

```
script-src 'self' https://www.livediagrams.dev;
frame-src https://www.livediagrams.dev;
connect-src 'self';   /* or wherever src-json lives */
```

`tests/e2e/host-embed.spec.ts` serves its host page under exactly such a policy and fails on any violation.

### Our side: headers

- The viewer (`?embed=1&host=1…`) gets the embeds' CSP: `frame-ancestors *`, everything else as strict as the app.
- `/embed/live-diagram.js` is sent with `Access-Control-Allow-Origin: *` (module scripts load with CORS),
  `Cross-Origin-Resource-Policy: cross-origin` and `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`:
  its URL isn't versioned, so a fix reaches every page within the hour (`scripts/security-headers.ts`).

## Tests

- Unit: `src/interop/embed/hostProtocol.test.ts` (parsing, origin rule, size and rate bounds, no `"*"` anywhere),
  `hostReducer.test.ts` (the state machine and the live driver), `hostSnippets.test.ts` (the dialog's code),
  `src/lib/securityHeaders.test.ts` (the script's headers).
- End to end: `tests/e2e/host-embed.spec.ts`: a host page on another site (127.0.0.1, a test server) with a strict
  CSP and a session cookie loads the web component, which fetches the Kafka example and plays it; commands, events,
  auto-height and the theme; no request to the app and no frame URL or storage ever holds the diagram; a sibling
  frame and a parent at the wrong origin are ignored and hear nothing; oversized and invalid loads are refused; the
  Embed dialog's private option and its preview.
