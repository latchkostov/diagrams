import type { FlowNode } from "./types";
import type { MemberBox } from "./membership";

/** One geometry adapter for membership settlement and its drag preview. */
export function memberBoxes(ns: readonly FlowNode[], fallback = { width: 0, height: 0 }): MemberBox[] {
  return ns
    .filter((n) => n.type !== "boundary")
    .map((n) => ({
      id: n.id,
      ...n.position,
      width: n.measured?.width ?? n.width ?? fallback.width,
      height: n.measured?.height ?? n.height ?? fallback.height,
      group: n.data.group,
    }));
}
