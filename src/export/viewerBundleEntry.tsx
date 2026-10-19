// Isolate storage before any app module evaluates, just as the Interactive HTML entry does.
import "./viewer/storage";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "../styles/tokens.css";
import "../styles/app.css";
import "../styles/canvas.css";
import "../styles/interop.css";
import "../interop/embed/hostEmbed.css";
import "./viewer/viewer.css";
import "virtual:viewer-fonts.css";
import { SettingsProvider } from "../harness/SettingsProvider";
import { markWorkerUnsupported } from "../live/liveRenderer";
import { ViewerAdapter } from "./viewer/adapter";
import { BundleApp } from "./viewer/BundleApp";

markWorkerUnsupported();
const adapter = new ViewerAdapter();
const root = createRoot(document.getElementById("root")!);
root.render(
  <SettingsProvider>
    <BundleApp adapter={adapter} />
  </SettingsProvider>,
);

// A same-frame platform bridge calls this object; no message listener or network/storage transport.
declare global {
  interface Window {
    liveDiagramsViewer: ViewerAdapter;
  }
}
window.liveDiagramsViewer = adapter;
window.addEventListener(
  "pagehide",
  () => {
    root.unmount();
    adapter.dispose();
  },
  { once: true },
);
