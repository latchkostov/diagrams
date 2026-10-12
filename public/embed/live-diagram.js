// <live-diagram>: a Live Diagrams viewer whose diagram your page supplies. https://www.livediagrams.dev
//
//   <script type="module" src="https://www.livediagrams.dev/embed/live-diagram.js"></script>
//   <live-diagram src-json="/api/diagrams/orders.diagram.json" simulation="black-friday" autoplay></live-diagram>
//
// or, from your own code: document.querySelector("live-diagram").diagram = { format: "diagrams/v1", ... }.
//
// `src-json` is fetched by your page, from your server, with your page's cookies and sign-in: your access
// control applies. The diagram then goes to the viewer frame with postMessage and lives only in its memory: it
// is never put in a URL, never stored and never sent to livediagrams.dev, which only serves the viewer's code.
// Protocol, events and methods: https://github.com/latchkostov/diagrams/blob/master/docs/EMBEDDING.md
//
// Standalone and dependency-free. It runs under your page's Content-Security-Policy: no eval, no inline
// styles (the one stylesheet is a constructed CSSStyleSheet), and it only needs script-src and frame-src to
// allow the viewer's origin.

const PROTOCOL = "livediagrams.embed.v1";
/** The viewer is the page next to this script's folder (works under a sub-path too). */
const VIEWER = new URL("../", import.meta.url);
const MAX_CHARS = 8_000_000;
const EVENTS = ["ready", "loaded", "error", "nodeClick", "simulationChanged", "playState", "resize"];

const sheet = (() => {
  try {
    const s = new CSSStyleSheet();
    s.replaceSync(
      ":host{display:block;position:relative}" +
        "iframe{display:block;width:100%;height:100%;min-height:120px;border:0;border-radius:inherit;background:transparent}",
    );
    return s;
  } catch {
    return null;
  }
})();

class LiveDiagram extends HTMLElement {
  static observedAttributes = ["src-json", "theme", "simulation", "speed", "height", "title"];

  #frame = null;
  #ready = false;
  #diagram = undefined;
  #queue = [];
  #seq = 0;
  #pending = new Map();
  #fetches = 0;
  #onMessage = (event) => this.#receive(event);

  connectedCallback() {
    // `el.diagram = …` before this script ran set a plain property on the element: hand it to the setter.
    if (Object.prototype.hasOwnProperty.call(this, "diagram")) {
      const value = this.diagram;
      delete this.diagram;
      this.diagram = value;
    }
    if (this.#frame) return;
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    if (sheet) root.adoptedStyleSheets = [sheet];
    const origin = window.location.origin;
    if (!origin || origin === "null") {
      this.#emit("error", {
        code: "no_origin",
        message: "<live-diagram> needs a page with an http(s) origin (not a file:// page or a sandboxed frame).",
      });
      return;
    }
    const src = new URL(VIEWER);
    src.search = new URLSearchParams({ embed: "1", host: "1", hostOrigin: origin }).toString();
    const frame = document.createElement("iframe");
    frame.src = src.href;
    frame.title = this.getAttribute("title") || "Diagram";
    // The viewer can't navigate your page; it opens new tabs only from its "Made with Live Diagrams" link.
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    if (this.getAttribute("loading") === "lazy") frame.loading = "lazy";
    // A stable hook for your own UI tests (and ours).
    frame.dataset.testid = "live-diagram-frame";
    frame.part = "frame";
    this.#frame = frame;
    this.#applyHeight(Number(this.getAttribute("height")) || 360);
    window.addEventListener("message", this.#onMessage);
    root.append(frame);
    if (this.hasAttribute("src-json") && this.#diagram === undefined) void this.#fetchJson();
  }

  disconnectedCallback() {
    window.removeEventListener("message", this.#onMessage);
    this.#frame?.remove();
    this.#frame = null;
    this.#ready = false;
    for (const { reject } of this.#pending.values()) reject(new Error("The viewer was removed from the page."));
    this.#pending.clear();
  }

  attributeChangedCallback(name, before, after) {
    if (before === after || !this.#frame) return;
    if (name === "src-json" && after) void this.#fetchJson();
    else if (name === "theme" && (after === "light" || after === "dark")) this.setTheme(after);
    else if (name === "simulation") this.selectSimulation(after || null);
    else if (name === "speed" && after) this.setSpeed(Number(after));
    else if (name === "height" && after) this.#applyHeight(Number(after));
    else if (name === "title") this.#frame.title = after || "Diagram";
  }

  /** The diagram shown: set it (an object or its JSON text) to show another one. */
  get diagram() {
    return this.#diagram;
  }
  set diagram(value) {
    void this.load(value).catch(() => {});
  }

  /** Shows `diagram` (object or JSON text). Resolves with the `loaded` details, rejects with the `error`. */
  load(diagram, options = {}) {
    this.#diagram = diagram;
    const id = `load-${++this.#seq}`;
    const done = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
    // A newer load replaces any still waiting for the frame.
    this.#queue = this.#queue.filter((m) => m.type !== "load");
    this.#queue.unshift({ type: "load", id, diagram, options: { ...this.#attributeOptions(), ...options } });
    this.#flush();
    return done;
  }

  play() {
    this.#send({ type: "play" });
  }
  pause() {
    this.#send({ type: "pause" });
  }
  /** 0.25, 0.5, 1, 2, 4 or 8. */
  setSpeed(speed) {
    this.#send({ type: "setSpeed", speed });
  }
  /** A saved simulation's id, or null for free play. It starts playing. */
  selectSimulation(simulation) {
    this.#send({ type: "selectSimulation", simulation });
  }
  fit() {
    this.#send({ type: "fit" });
  }
  /** "light" or "dark". */
  setTheme(theme) {
    this.#send({ type: "setTheme", theme });
  }
  /** Rings these nodes; [] clears. */
  highlight(nodeIds) {
    this.#send({ type: "highlight", nodeIds: Array.from(nodeIds ?? []) });
  }

  #attributeOptions() {
    const o = {};
    const theme = this.getAttribute("theme");
    if (theme === "light" || theme === "dark") o.theme = theme;
    const simulation = this.getAttribute("simulation");
    if (simulation) o.simulation = simulation;
    if (this.hasAttribute("autoplay")) o.autoplay = true;
    const speed = Number(this.getAttribute("speed"));
    if (speed) o.speed = speed;
    if (this.getAttribute("fit") === "false") o.fit = false;
    return o;
  }

  async #fetchJson() {
    const attr = this.getAttribute("src-json");
    if (!attr) return;
    const run = ++this.#fetches;
    const credentials = this.getAttribute("credentials") === "include" ? "include" : "same-origin";
    try {
      // Your page's request: same origin by default, with its cookies; your server decides who may read it.
      const res = await fetch(new URL(attr, document.baseURI), { credentials, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Couldn't fetch the diagram (HTTP ${res.status}).`);
      const text = await res.text();
      if (text.length > MAX_CHARS) throw new Error("The diagram is too large to show (the limit is 8 MB).");
      if (run !== this.#fetches) return;
      await this.load(text);
    } catch (err) {
      if (run !== this.#fetches) return;
      if (err && err.code) return; // already reported by the viewer's `error`
      this.#emit("error", { code: "fetch_failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  #applyHeight(px) {
    if (this.#frame && px > 0) this.#frame.style.height = `${Math.round(px)}px`;
  }

  #send(message) {
    this.#queue.push(message);
    this.#flush();
  }

  #flush() {
    if (!this.#ready || !this.#frame?.contentWindow) return;
    for (const m of this.#queue.splice(0))
      // Only ever to the viewer's origin: never "*".
      this.#frame.contentWindow.postMessage({ protocol: PROTOCOL, ...m }, VIEWER.origin);
  }

  #receive(event) {
    // Only this element's own frame, from the viewer's origin, speaking this protocol.
    if (!this.#frame || event.source !== this.#frame.contentWindow || event.origin !== VIEWER.origin) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.protocol !== PROTOCOL || !EVENTS.includes(data.type)) return;
    const { protocol: _protocol, type, ...detail } = data;
    if (type === "ready") {
      this.#ready = true;
      // A reloaded frame gets the current diagram again.
      if (this.#diagram !== undefined && !this.#queue.some((m) => m.type === "load")) {
        this.#queue.unshift({
          type: "load",
          id: `load-${++this.#seq}`,
          diagram: this.#diagram,
          options: this.#attributeOptions(),
        });
      }
      this.#flush();
    } else if (type === "resize" && !this.hasAttribute("height")) {
      this.#applyHeight(detail.height);
    } else if ((type === "loaded" || type === "error") && detail.id && this.#pending.has(detail.id)) {
      const { resolve, reject } = this.#pending.get(detail.id);
      this.#pending.delete(detail.id);
      if (type === "loaded") resolve(detail);
      else reject(Object.assign(new Error(detail.message), { code: detail.code }));
    }
    this.#emit(type, detail);
  }

  #emit(type, detail) {
    // DOM event names are lower case: nodeclick, simulationchanged, playstate, resize, loaded, error, ready.
    this.dispatchEvent(new CustomEvent(type.toLowerCase(), { detail }));
  }
}

if (!customElements.get("live-diagram")) customElements.define("live-diagram", LiveDiagram);

export { LiveDiagram };
