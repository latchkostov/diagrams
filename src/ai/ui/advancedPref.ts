// Whether the AI panel's Advanced section is open: closed by default, remembered in this browser.

const OPEN_KEY = "diagrams.ai-advanced.v1";

export function readAdvancedOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberAdvancedOpen(open: boolean): void {
  try {
    if (open) localStorage.setItem(OPEN_KEY, "1");
    else localStorage.removeItem(OPEN_KEY);
  } catch {
    // Storage blocked: it lasts for this visit.
  }
}
