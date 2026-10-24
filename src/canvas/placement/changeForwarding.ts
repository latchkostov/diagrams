import type { EdgeChange, NodeChange } from "@xyflow/react";
import type { InteractionController } from "../interaction/controller";

/** React Flow measurements and click selection are shared by editing and read-only canvases. */
export function selectionChanges<C extends NodeChange | EdgeChange>(
  store: { getState(): { userSelectionActive: boolean } },
  menus: Pick<InteractionController, "selecting">,
  changes: C[],
): C[] {
  const next = store.getState().userSelectionActive ? changes.filter((c) => c.type !== "select") : changes;
  if (next.some((c) => c.type === "select")) menus.selecting("click");
  return next;
}
