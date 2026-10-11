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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);
