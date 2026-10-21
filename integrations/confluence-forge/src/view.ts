import "virtual:forge-viewer";
import { requestConfluence, view } from "@forge/bridge";
import { t } from "../../../src/i18n/core";
import { configForStorage, contentId } from "./config";
import { downloadDiagramText } from "./attachments";
import { element, errorMessage, followTheme } from "./dom";
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
    const config = configForStorage(context.extension.config);
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
      page = contentId(context.extension.content?.id);
    } catch {
      throw new Error(t("viewerForge.pageRequired"));
    }
    const text = await downloadDiagramText(requestConfluence, page, config.attachmentId);
    adapter.on("size", ({ height }) => {
      root.style.height = `${config.height || Math.max(200, Math.min(1600, height))}px`;
    });
    root.style.height = `${config.height || 380}px`;
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
    header.append(play);
  } catch (error) {
    root.hidden = true;
    status.setAttribute("role", "alert");
    status.textContent = errorMessage(error);
  }
}

void main();
