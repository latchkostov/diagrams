// The exported HTML file's script (built by scripts/interactive-viewer.ts into one inline <script>). The
// sandbox goes first: it swaps the page's storage for in-memory stores before any of the app's modules run.
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
