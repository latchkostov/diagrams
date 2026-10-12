// The exported HTML file's script (built by scripts/interactive-viewer.ts into one inline <script>).
// Order matters: ./viewer/storage imports nothing and runs first, swapping the page's storage for in-memory
// stores before any app module is evaluated (some read storage as they load); then the viewer's set-up.
import "./viewer/storage";
import "./viewer/sandbox";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "../styles/tokens.css";
import "../styles/app.css";
import "../styles/canvas.css";
import "../styles/interop.css";
import "./viewer/viewer.css";
import { SettingsProvider } from "../harness/SettingsProvider";
import { ViewerApp } from "./viewer/ViewerApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <ViewerApp />
    </SettingsProvider>
  </StrictMode>,
);
