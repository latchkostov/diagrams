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
import { markWorkerUnsupported } from "../live/liveRenderer";
import { ViewerAdapter } from "./viewer/adapter";
import { BundleApp } from "./viewer/BundleApp";

markWorkerUnsupported();
const adapter = new ViewerAdapter();
adapter.connectEscape();
const root = createRoot(document.getElementById("root")!);
declare const __VIEWER_ATTRIBUTION__: "show" | "hide";
root.render(<BundleApp adapter={adapter} attribution={__VIEWER_ATTRIBUTION__} />);

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
