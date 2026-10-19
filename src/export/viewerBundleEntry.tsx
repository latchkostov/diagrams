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
import { Toaster } from "../interop/ui/Toaster";
import { BundleApp } from "./viewer/BundleApp";

markWorkerUnsupported();
const adapter = new ViewerAdapter();
const root = createRoot(document.getElementById("root")!);
root.render(
  <SettingsProvider>
    <BundleApp adapter={adapter} />
    <Toaster />
  </SettingsProvider>,
);

// A same-frame platform bridge calls this object; no message listener or network/storage transport.
declare global {
  interface Window {
    liveDiagramsViewer: ViewerAdapter;
  }
}
window.liveDiagramsViewer = adapter;
// Cached documents resume without evaluating this entry again. Keep their root and subscriptions intact.
const teardown = (event: PageTransitionEvent) => {
  if (event.persisted) return;
  window.removeEventListener("pagehide", teardown);
  root.unmount();
  adapter.dispose();
};
window.addEventListener("pagehide", teardown);
