// Whether the AI panel's Advanced section is open: closed by default, remembered in this browser.

import { safeStorage } from "../../lib/storage";

const OPEN_KEY = "diagrams.ai-advanced.v1";

export function readAdvancedOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Storage blocked or full: it lasts for this visit. */
export function rememberAdvancedOpen(open: boolean): void {
  if (open) safeStorage.setItem(OPEN_KEY, "1");
  else safeStorage.removeItem(OPEN_KEY);
}
