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
/** The viewer's limits (src/interop/embed/hostProtocol.ts): JSON characters, and nesting depth. */
const MAX_CHARS = 8_000_000;
const MAX_DEPTH = 48;
/** A load the viewer hasn't answered this long after it was sent is given up (a frame that never loaded). */
const LOAD_TIMEOUT_MS = 60_000;
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

/** An Error with the protocol's `code` (and the same `message` the `error` event carries). */
const failure = (code, message) => Object.assign(new Error(message), { code });

/**
 * Whether an object's JSON would fit, walked without serialising it: shared references (which JSON repeats) and
 * cycles can't blow up memory here. "ok", "too_large" or "too_deep", like the viewer's own check.
 */
function jsonBudget(value) {
  let size = 0;
  const frames = [];
  const visit = (v, depth) => {
    if (typeof v === "string") size += v.length + 2;
    else if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") size += String(v).length;
    else if (v === null || v === undefined) size += 4;
    else if (typeof v === "object") {
      if (depth >= MAX_DEPTH) return "too_deep";
      const keys = Array.isArray(v) ? null : Object.keys(v);
      const items = keys ? keys.map((k) => v[k]) : v;
      size += items.length ? 1 + items.length : 2;
      if (keys) for (const k of keys) size += k.length + 3;
      if (size > MAX_CHARS) return "too_large";
      frames.push({ items, i: 0, depth: depth + 1 });
    }
    return size > MAX_CHARS ? "too_large" : "ok";
  };
  let result = visit(value, 0);
  while (result === "ok" && frames.length) {
    const top = frames[frames.length - 1];
    if (top.i >= top.items.length) frames.pop();
    else result = visit(top.items[top.i++], top.depth);
  }
  return result;
}

/** Why a diagram can't be sent, or null: checked here, before anything is copied to the frame. */
function refusal(diagram) {
  if (typeof diagram === "string")
    return diagram.length > MAX_CHARS ? failure("too_large", "The diagram is too large (the limit is 8 MB of JSON).") : null;
  if (!diagram || typeof diagram !== "object" || Array.isArray(diagram))
    return failure("invalid_diagram", "The diagram must be the diagram object or its JSON text.");
  const budget = jsonBudget(diagram);
  if (budget === "too_large") return failure("too_large", "The diagram is too large (the limit is 8 MB of JSON).");
  if (budget === "too_deep") return failure("invalid_diagram", "The diagram is nested too deeply.");
  return null;
}

/** The response's text, refused as soon as it passes `max` characters (never buffered whole first). */
async function readBounded(res, max) {
  const tooLarge = () => failure("too_large", "The diagram is too large to show (the limit is 8 MB).");
  // UTF-8 takes at most 4 bytes a character: a declared length past that can't fit.
  const declared = Number(res.headers.get("Content-Length"));
  if (declared > max * 4) {
    await res.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!res.body) {
    const text = await res.text();
    if (text.length > max) throw tooLarge();
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    const part = done ? decoder.decode() : decoder.decode(value, { stream: true });
    length += part.length;
    if (length > max) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    parts.push(part);
    if (done) return parts.join("");
  }
}

class LiveDiagram extends HTMLElement {
  static observedAttributes = ["src-json", "theme", "simulation", "speed", "height", "title"];

  #frame = null;
  #ready = false;
  #diagram = undefined;
  /** Messages waiting for the frame's `ready`, in order (at most one load: the newest). */
  #queue = [];
  #seq = 0;
  /** Load requests not yet answered: id -> { resolve, reject, timer }. Every one settles. */
  #pending = new Map();
  /** Which load is current: every load (fetched or supplied) takes the next one; older work drops out. */
  #generation = 0;
  #fetch = null;
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
    // Nothing in flight survives: a pending fetch is abandoned, every waiting load settles.
    this.#generation++;
    this.#fetch?.abort();
    this.#fetch = null;
    this.#queue = this.#queue.filter((m) => m.type !== "load");
    for (const id of [...this.#pending.keys()])
      this.#settle(id, failure("disconnected", "The viewer was removed from the page."));
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

  /**
   * Shows `diagram` (object or JSON text), replacing whatever is shown or still loading (a `src-json` fetch in
   * flight included). Resolves with the `loaded` details; rejects with an Error whose `code` says why (the
   * viewer's codes, plus `superseded` when a newer load replaced it before it was sent, `timeout`, `disconnected`).
   */
  load(diagram, options = {}) {
    this.#generation++;
    this.#fetch?.abort();
    this.#fetch = null;
    return this.#queueLoad(diagram, options);
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

  #queueLoad(diagram, options) {
    const id = `load-${++this.#seq}`;
    const done = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject, timer: 0 }));
    const refused = refusal(diagram);
    if (refused) {
      this.#settle(id, refused);
      this.#emit("error", { id, code: refused.code, message: refused.message });
      return done;
    }
    this.#diagram = diagram;
    // A newer load replaces one still waiting for the frame: that one settles now, as superseded.
    for (const m of this.#queue)
      if (m.type === "load") this.#settle(m.id, failure("superseded", "A newer diagram replaced this one."));
    this.#queue = this.#queue.filter((m) => m.type !== "load");
    this.#queue.unshift({ type: "load", id, diagram, options: { ...this.#attributeOptions(), ...options } });
    this.#flush();
    return done;
  }

  async #fetchJson() {
    const attr = this.getAttribute("src-json");
    if (!attr) return;
    const generation = ++this.#generation;
    this.#fetch?.abort();
    const controller = (this.#fetch = new AbortController());
    const credentials = this.getAttribute("credentials") === "include" ? "include" : "same-origin";
    let text;
    try {
      // Your page's request: same origin by default, with its cookies; your server decides who may read it.
      const res = await fetch(new URL(attr, document.baseURI), {
        credentials,
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) throw failure("fetch_failed", `Couldn't fetch the diagram (HTTP ${res.status}).`);
      text = await readBounded(res, MAX_CHARS);
    } catch (err) {
      // A newer load (or the element leaving the page) took over: this fetch no longer matters.
      if (generation !== this.#generation) return;
      this.#fetch = null;
      const code = err && err.code ? err.code : "fetch_failed";
      this.#emit("error", { code, message: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (generation !== this.#generation) return;
    this.#fetch = null;
    // The viewer's answer arrives as `loaded` or `error` events too.
    this.#queueLoad(text, {}).catch(() => {});
  }

  #settle(id, error, detail) {
    const entry = this.#pending.get(id);
    if (!entry) return;
    this.#pending.delete(id);
    clearTimeout(entry.timer);
    if (error) entry.reject(error);
    else entry.resolve(detail);
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
    for (const m of this.#queue.splice(0)) {
      const entry = m.type === "load" ? this.#pending.get(m.id) : undefined;
      if (entry)
        entry.timer = setTimeout(
          () => this.#settle(m.id, failure("timeout", "The viewer didn't answer.")),
          LOAD_TIMEOUT_MS,
        );
      // Only ever to the viewer's origin: never "*".
      this.#frame.contentWindow.postMessage({ protocol: PROTOCOL, ...m }, VIEWER.origin);
    }
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
    } else if ((type === "loaded" || type === "error") && detail.id) {
      this.#settle(detail.id, type === "error" ? failure(detail.code, detail.message) : null, detail);
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
