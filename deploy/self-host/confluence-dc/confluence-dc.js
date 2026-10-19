// Copy next to the existing embed/live-diagram.js in your self-hosted build.
/* global HTMLElement, IntersectionObserver, queueMicrotask, URL, location, customElements */
import "./live-diagram.js";

// A wrapper keeps multiple macros and content inserted after page load independent.
class ConfluenceLiveDiagram extends HTMLElement {
  connectedCallback() {
    // Defer until the parser has supplied the macro's children too.
    queueMicrotask(() => this.observe());
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    this.observer = null;
  }

  observe() {
    if (!this.isConnected || this.initialized || this.observer) return;
    const height = Number(this.dataset.height);
    this.height = Number.isInteger(height) && height >= 120 && height <= 1600 ? height : 480;
    // Reserve the canvas space before it exists, so scrolling does not move neighbouring macros.
    this.style.display = "block";
    this.querySelector('[data-testid="confluence-canvas"]').style.minHeight = `${this.height}px`;
    this.querySelector('[data-testid="confluence-play"]').hidden = this.dataset.clickToPlay === "false";
    this.observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      this.observer.disconnect();
      this.observer = null;
      this.initialize();
    });
    this.observer.observe(this);
    // A deferred canvas must remain reachable without a pointer or scrolling first.
    this.tabIndex = 0;
    this.setAttribute("role", "region");
    this.setAttribute("aria-label", "Diagram");
    this.onfocus = () => this.initialize();
  }

  initialize() {
    if (this.initialized) return;
    const template = this.querySelector('[data-testid="confluence-viewer-template"]');
    const viewer = template?.content.querySelector('[data-testid="confluence-viewer"]')?.cloneNode(true);
    const play = this.querySelector('[data-testid="confluence-play"]');
    const error = this.querySelector('[data-testid="confluence-error"]');
    if (!viewer || !play || !error) return;
    this.initialized = true;
    this.observer?.disconnect();
    this.observer = null;
    this.onfocus = null;
    viewer.setAttribute("height", String(this.height));
    play.hidden = this.dataset.clickToPlay === "false";
    let simulation;
    viewer.addEventListener("loaded", (event) => {
      simulation = event.detail.simulations[0]?.id;
      const title = event.detail.title?.trim() || "Untitled diagram";
      viewer.setAttribute("title", title);
      play.setAttribute("aria-label", `Play diagram: ${title}`);
      play.disabled = false;
    });
    viewer.addEventListener("error", (event) => {
      error.textContent = `Could not load diagram: ${event.detail.message}`;
      error.hidden = false;
      play.disabled = true;
    });
    // The first saved simulation is selected only by this reader action, never by loading a file.
    play.addEventListener("click", () => {
      if (simulation) viewer.selectSimulation(simulation);
      else viewer.play();
    });
    template.replaceWith(viewer);
    try {
      const source = (this.dataset.source ?? "").trim();
      if (!source) throw new Error("Set Diagram source to an attachment URL or inline JSON.");
      if (source.startsWith("{")) {
        // Explicitly suppress autoplay, regardless of the diagram's saved presentation settings.
        void viewer.load(source, { autoplay: false }).catch(() => {});
      } else {
        const url = new URL(source, location.href);
        if (url.origin !== location.origin || !["http:", "https:"].includes(url.protocol))
          throw new Error("Use an attachment URL on this Confluence origin.");
        // Fetches with the host page's session; attachment permissions remain Confluence's responsibility.
        viewer.setAttribute("src-json", url.href);
      }
    } catch (cause) {
      error.textContent = `Could not load diagram: ${cause.message}`;
      error.hidden = false;
    }
  }
}

if (!customElements.get("confluence-live-diagram"))
  customElements.define("confluence-live-diagram", ConfluenceLiveDiagram);
