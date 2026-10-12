// The embed dialog's code for a host-supplied embed: the <live-diagram> web component, or a raw iframe and
// postMessage. Neither holds the diagram: it stays on the host's own server, fetched by the host's page.

import { appBaseUrl } from "../share";

/** The protocol name, as the snippets spell it out (hostProtocol.ts PROTOCOL; a unit test keeps them equal). */
export const SNIPPET_PROTOCOL = "livediagrams.embed.v1";

export interface HostSnippetOptions {
  /** Where the host serves the diagram file (a path on its own site, or a URL its page may fetch). */
  srcJson: string;
  title: string;
  /** A saved simulation to play at once. */
  simulation?: string;
  /** Fixed height in px; absent: the frame sizes itself to the diagram. */
  height?: number;
  theme?: "light" | "dark";
}

const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
/** A JS string literal that can't close the <script> it sits in. */
const js = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** The host-supplied embed's own URL, for a page at `hostOrigin`. No diagram in it, ever. */
export function hostEmbedUrl(hostOrigin: string, base = appBaseUrl()): string {
  return `${base}?${new URLSearchParams({ embed: "1", host: "1", hostOrigin })}`;
}

/** The web component, a file name a host can serve as is (the native export's own name). */
export function webComponentSnippet(o: HostSnippetOptions, base = appBaseUrl()): string {
  const script = new URL("embed/live-diagram.js", base).href;
  const attrs = [
    `src-json="${attr(o.srcJson)}"`,
    `title="${attr(o.title)}"`,
    o.theme ? `theme="${o.theme}"` : "",
    o.simulation ? `simulation="${attr(o.simulation)}" autoplay` : "",
    o.height ? `height="${Math.round(o.height)}"` : "",
  ].filter(Boolean);
  return `<script type="module" src="${attr(script)}"></script>\n<live-diagram ${attrs.join(" ")}></live-diagram>`;
}

/** A plain iframe and the postMessage handshake, for pages that would rather not load our script. */
export function iframeSnippet(o: HostSnippetOptions, base = appBaseUrl()): string {
  const viewer = new URL(base);
  const options: Record<string, unknown> = {};
  if (o.theme) options.theme = o.theme;
  if (o.simulation) Object.assign(options, { simulation: o.simulation, autoplay: true });
  return [
    `<iframe id="live-diagram" title="${attr(o.title)}" width="100%" height="${Math.round(o.height ?? 480)}" style="border:0"`,
    `  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>`,
    `<script type="module">`,
    `  const VIEWER = ${js(viewer.origin)};`,
    `  const PROTOCOL = ${js(SNIPPET_PROTOCOL)};`,
    `  const frame = document.getElementById("live-diagram");`,
    `  // Your page's origin goes in the URL: the viewer only talks to it. The diagram never does.`,
    `  frame.src = ${js(viewer.origin + viewer.pathname)} + "?embed=1&host=1&hostOrigin=" + encodeURIComponent(location.origin);`,
    `  window.addEventListener("message", async (event) => {`,
    `    if (event.source !== frame.contentWindow || event.origin !== VIEWER) return;`,
    `    const msg = event.data;`,
    `    if (msg?.protocol !== PROTOCOL) return;`,
    `    if (msg.type === "ready") {`,
    `      // Fetched by your page, with its cookies and sign-in: your access control applies.`,
    `      const diagram = await (await fetch(${js(o.srcJson)})).json();`,
    `      frame.contentWindow.postMessage({ protocol: PROTOCOL, type: "load", diagram, options: ${js(options)} }, VIEWER);`,
    o.height ? "" : `    } else if (msg.type === "resize") {\n      frame.style.height = msg.height + "px";`,
    `    } else if (msg.type === "error") {`,
    `      console.error("Live Diagrams:", msg.message);`,
    `    }`,
    `  });`,
    `</script>`,
  ]
    .filter(Boolean)
    .join("\n");
}
