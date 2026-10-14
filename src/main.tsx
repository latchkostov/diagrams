// First, so its Esc listener is the first on the window (see the module).
import "./lib/fullscreenEscape";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/mona-sans/wdth.css";
import "@fontsource-variable/geist-mono";
import "@xyflow/react/dist/style.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/gallery.css";
import "./styles/canvas.css";
import { SettingsProvider } from "./harness/SettingsProvider";
import { App } from "./App";
import { startStorageLifecycle } from "./lib/storage";
import { startI18n } from "./i18n/start";

// This page takes part in Clear everything on this device (the exported HTML viewer, its own entry, doesn't).
startStorageLifecycle();

const render = () =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </StrictMode>,
  );
// In English at once; in another language once its catalog is in (in English if it can't be had).
void (startI18n()?.then(render, render) ?? render());
