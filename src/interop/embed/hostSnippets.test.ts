import { describe, expect, it } from "vitest";
import { PROTOCOL } from "./hostProtocol";
import { hostEmbedUrl, iframeSnippet, SNIPPET_PROTOCOL, webComponentSnippet } from "./hostSnippets";

const BASE = "https://www.livediagrams.dev/";
const opts = { srcJson: "/diagrams/orders.diagram.json", title: "Orders <internal> & co", simulation: "black-friday" };

describe("host embed: the embed dialog's code", () => {
  it("spells the protocol the frame speaks", () => {
    expect(SNIPPET_PROTOCOL).toBe(PROTOCOL);
  });

  it("the viewer's URL names the host's origin and nothing of the diagram", () => {
    const url = new URL(hostEmbedUrl("https://app.example.com", BASE));
    expect(url.origin + url.pathname).toBe(BASE);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      embed: "1",
      host: "1",
      hostOrigin: "https://app.example.com",
    });
    expect(url.hash).toBe("");
  });

  it("the web component loads the script from this site and the diagram from the host's own path", () => {
    const s = webComponentSnippet(opts, BASE);
    expect(s).toBe(
      `<script type="module" src="https://www.livediagrams.dev/embed/live-diagram.js"></script>\n` +
        `<live-diagram src-json="/diagrams/orders.diagram.json" title="Orders &lt;internal> &amp; co" simulation="black-friday" autoplay></live-diagram>`,
    );
    expect(webComponentSnippet({ ...opts, simulation: undefined, height: 480 }, BASE)).toMatch(
      /<live-diagram src-json="[^"]+" title="[^"]+" height="480"><\/live-diagram>$/,
    );
    // Under a sub-path the script and the viewer sit under it too.
    expect(webComponentSnippet(opts, "https://example.org/tools/diagrams/")).toContain(
      `src="https://example.org/tools/diagrams/embed/live-diagram.js"`,
    );
  });

  it("the iframe version talks only to this site's origin, and can't be broken out of its script tag", () => {
    const s = iframeSnippet({ ...opts, srcJson: "/x</script><script>alert(1)//" }, BASE);
    expect(s).toContain(`const VIEWER = "https://www.livediagrams.dev";`);
    expect(s).toContain(`}, VIEWER);`);
    expect(s).not.toMatch(/postMessage\([^)]*["']\*["']/);
    expect(s).toContain(`encodeURIComponent(location.origin)`);
    expect(s).toContain(`event.source !== frame.contentWindow || event.origin !== VIEWER`);
    expect(s.match(/<\/script>/g)).toHaveLength(1);
    expect(s).toContain(`"simulation":"black-friday","autoplay":true`);
    // Auto-height unless a height is fixed.
    expect(s).toContain(`msg.type === "resize"`);
    expect(iframeSnippet({ ...opts, height: 640 }, BASE)).not.toContain(`"resize"`);
    expect(iframeSnippet({ ...opts, height: 640 }, BASE)).toContain(`height="640"`);
  });
});
