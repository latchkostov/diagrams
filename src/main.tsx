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

// This page takes part in Clear everything on this device (the exported HTML viewer, its own entry, doesn't).
startStorageLifecycle();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);
