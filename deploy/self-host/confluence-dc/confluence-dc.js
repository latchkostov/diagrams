// Copy next to the existing embed/live-diagram.js in your self-hosted build.
/* global HTMLElement, queueMicrotask, URL, location, customElements */
import "./live-diagram.js";

// A wrapper keeps multiple macros and content inserted after page load independent.
class ConfluenceLiveDiagram extends HTMLElement {
  connectedCallback() {
    // Defer until the parser has supplied the macro's children too.
    queueMicrotask(() => this.initialize());
  }

  initialize() {
    if (this.initialized) return;
    const viewer = this.querySelector('[data-testid="confluence-viewer"]');
    const play = this.querySelector('[data-testid="confluence-play"]');
    const error = this.querySelector('[data-testid="confluence-error"]');
    if (!viewer || !play || !error) return;
    this.initialized = true;
    const height = Number(this.dataset.height);
    viewer.setAttribute("height", String(Number.isInteger(height) && height >= 120 && height <= 1600 ? height : 480));
    play.hidden = this.dataset.clickToPlay === "false";
    viewer.addEventListener("loaded", () => (play.disabled = false));
    viewer.addEventListener("error", (event) => {
      error.textContent = `Could not load diagram: ${event.detail.message}`;
      error.hidden = false;
      play.disabled = true;
    });
    // The first saved simulation is selected only by this reader action, never by loading a file.
    play.addEventListener("click", () => {
      const simulation = viewer.diagram?.simulations?.[0]?.id;
      if (simulation) viewer.selectSimulation(simulation);
      else viewer.play();
    });
    try {
      const source = (this.dataset.source ?? "").trim();
      if (!source) throw new Error("Set Diagram source to an attachment URL or inline JSON.");
      if (source.startsWith("{")) {
        // Explicitly suppress autoplay, regardless of the diagram's saved presentation settings.
        void viewer.load(JSON.parse(source), { autoplay: false }).catch(() => {});
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
