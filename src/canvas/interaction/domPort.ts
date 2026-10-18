import type { ElementHandle } from "./types";

/** What has keyboard focus: null for nothing, or the page's body. */
export function domActive(): ElementHandle | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  return el && el !== document.body ? el : null;
}
