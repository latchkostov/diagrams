import "virtual:forge-viewer";
import { Modal, requestConfluence, view } from "@forge/bridge";
import { t } from "../../../src/i18n/core";
import { configForStorage, contentId } from "./config";
import { downloadDiagramText } from "./attachments";
import { element, errorMessage, followTheme } from "./dom";
import { macroHeight } from "./height";
import "./view.css";

async function main() {
  const header = element("header", "forge-header");
  const status = element("p", "forge-status", t("viewerForge.loading"));
  status.setAttribute("role", "status");
  header.append(status);
  document.body.prepend(header);
  const root = document.getElementById("root")!;
  root.hidden = true;
  try {
    const context = await view.getContext();
    const modal = context.extension.modal as { pageId?: unknown; config?: unknown } | undefined;
    const config = configForStorage(modal ? modal.config : context.extension.config);
    if (modal) {
      document.documentElement.classList.add("forge-modal");
      // Available even if loading or validating the attachment fails.
      const close = element("button", "forge-close", t("viewerForge.close"));
      close.type = "button";
      const dismiss = () =>
        void view.close().catch(() => {
          status.setAttribute("role", "alert");
          status.textContent = t("viewerForge.bridgeError");
          header.append(status);
        });
      close.addEventListener("click", dismiss);
      window.liveDiagramsViewer.on("unhandledEscape", dismiss);
      header.append(close);
    }
    const adapter = window.liveDiagramsViewer;
    followTheme(
      config,
      () => view.theme.enable(),
      (theme) => adapter.setTheme(theme),
    );
    if (!config.attachmentId) {
      status.textContent = t("viewerForge.configure");
      return;
    }
    let page: string;
    try {
      page = contentId(modal ? modal.pageId : context.extension.content?.id);
    } catch {
      throw new Error(t("viewerForge.pageRequired"));
    }
    const text = await downloadDiagramText(requestConfluence, page, config.attachmentId);
    if (!modal) {
      const resize = (fitted?: number) => {
        const height = `${macroHeight(config.height, fitted)}px`;
        // Forge observes document content to resize the iframe (no view.resize in bridge 7.2).
        // Avoid even redundant writes when a host or viewer repeats its size report.
        if (root.style.height !== height) root.style.height = height;
      };
      adapter.on("size", ({ height }) => resize(height));
      resize();
    }
    let missingSimulation = false;
    const off = adapter.on("loaded", ({ simulations }) => {
      missingSimulation = !!config.simulation && !simulations.some((s) => s.id === config.simulation);
    });
    const loaded = adapter.load(text);
    off();
    if (!loaded) throw new Error(t("viewerForge.invalid"));
    if (missingSimulation) throw new Error(t("viewerForge.missingSimulation"));
    root.hidden = false;
    document.body.classList.add("forge-still");
    const play = element("button", "forge-play", t("viewerForge.play"));
    play.type = "button";
    play.addEventListener("click", () => {
      adapter.play(config.simulation || undefined);
      document.body.classList.remove("forge-still");
      play.hidden = true;
    });
    status.remove();
    header.prepend(play);
    if (!modal) {
      const expand = element("button", "forge-maximise", t("viewerForge.maximise"));
      expand.type = "button";
      let open = false;
      expand.addEventListener("click", () => {
        if (open) return;
        open = true;
        expand.disabled = true;
        status.remove();
        adapter.stop();
        void new Modal({
          resource: "diagram-view",
          size: "max",
          context: { pageId: page, config },
          closeOnEscape: false,
          onClose: () => {
            open = false;
            expand.disabled = false;
            expand.focus();
          },
        })
          .open()
          .catch(() => {
            open = false;
            expand.disabled = false;
            status.setAttribute("role", "alert");
            status.textContent = t("viewerForge.modalError");
            header.append(status);
          });
      });
      header.append(expand);
    }
  } catch (error) {
    root.hidden = true;
    status.setAttribute("role", "alert");
    status.textContent = errorMessage(error);
  }
}

void main();
