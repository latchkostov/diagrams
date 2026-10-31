import process from "node:process";

/** Native text-caret movement differs from menus/ranges, whose Home/End are app keys. */
export function textBoundaryKey(boundary: "start" | "end", platform = process.platform): string {
  return platform === "darwin"
    ? `ControlOrMeta+Arrow${boundary === "start" ? "Left" : "Right"}`
    : boundary === "start"
      ? "Home"
      : "End";
}

/** Tutorial recipes use document boundaries, which macOS binds to Command + vertical arrows. */
export function tutorialKey(combo: string, platform = process.platform): string {
  if (platform === "darwin") {
    if (combo === "ControlOrMeta+End") return "Meta+ArrowDown";
    if (combo === "ControlOrMeta+Home") return "Meta+ArrowUp";
  }
  return combo;
}
