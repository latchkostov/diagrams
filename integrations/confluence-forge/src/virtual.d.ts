declare module "virtual:forge-viewer";

interface Window {
  liveDiagramsViewer: import("../../../src/export/viewer/adapter").ViewerAdapter;
}
