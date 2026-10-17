import process from "node:process";

/** Native text-caret movement differs from menus/ranges, whose Home/End are app keys. */
export function textBoundaryKey(boundary: "start" | "end", platform = process.platform): string {
  return platform === "darwin"
    ? `ControlOrMeta+Arrow${boundary === "start" ? "Left" : "Right"}`
    : boundary === "start"
      ? "Home"
      : "End";
}
