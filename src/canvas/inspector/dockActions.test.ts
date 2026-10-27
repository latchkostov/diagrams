import { afterEach, expect, it, vi } from "vitest";
import { activateDock, closeWorkbenchDock } from "./dockActions";
import { workbenchDock } from "./dockState";
import { checksPanel } from "../checks/checksPanel";

afterEach(() => {
  closeWorkbenchDock();
  checksPanel.setAvailable(false);
  vi.unstubAllGlobals();
});
it("R-8ea66b0634 rejects unavailable Checks before publishing dock state", () => {
  vi.stubGlobal("HTMLElement", EventTarget);
  checksPanel.setAvailable(true);
  activateDock("checks");
  closeWorkbenchDock();
  checksPanel.setAvailable(false);
  const seen: string[] = [];
  const stop = workbenchDock.subscribe(() => seen.push(workbenchDock.get().value));
  activateDock("checks");
  stop();
  expect(seen).toEqual(["properties"]);
  expect(workbenchDock.get().value).toBe("properties");
  expect(checksPanel.isOpen()).toBe(false);
});
