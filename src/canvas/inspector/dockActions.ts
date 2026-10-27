import { aiDock } from "../../ai/ui/dock";
import { checksPanel } from "../checks/checksPanel";
import { workbenchDock, type DockTab } from "./dockState";
export function activateDock(tab: DockTab) {
  if (tab === "checks" && !checksPanel.isAvailable()) tab = "properties";
  workbenchDock.show(tab);
  if (tab === "ai") aiDock.set({ open: true });
  // Other tabs hide the mounted AI surface; switching tabs must not discard an unfinished reply.
  if (tab === "checks") checksPanel.open();
  else checksPanel.close();
}
export function closeWorkbenchDock() {
  workbenchDock.close();
  checksPanel.close();
  aiDock.set({ open: false });
}
