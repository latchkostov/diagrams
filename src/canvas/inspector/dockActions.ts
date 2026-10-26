import { aiDock } from "../../ai/ui/dock";
import { checksPanel } from "../checks/checksPanel";
import { workbenchDock, type DockTab } from "./dockState";
export function activateDock(tab: DockTab) {
  workbenchDock.show(tab);
  if (tab === "ai") aiDock.set({ open: true });
  else if (tab === "properties") aiDock.set({ open: false });
  if (tab === "checks") checksPanel.open();
  else checksPanel.close();
}
export function closeWorkbenchDock() {
  workbenchDock.close();
  checksPanel.close();
  aiDock.set({ open: false });
}
