import { expect, it } from "vitest";
import { ActionRegistry, builtinSections } from "./actions";
import { builtinActions } from "./builtinActions";
import { editorHarness } from "../test/editorHarness";
import { keyboardSelectionFixture } from "../lab/keyboardSelectionFixture";

it("one Boundary row contains create/adopt/remove while Ctrl+K retains their original identities", () => {
  const h = editorHarness(keyboardSelectionFixture);
  h.api.select({ nodeIds: ["orders"] });
  const registry = new ActionRegistry(builtinSections);
  registry.register(builtinActions());
  const ctx = { target: "node" as const, nodeId: "orders", selection: h.api.getSelection(), editor: h.api };
  const menu = registry.build(ctx).filter((item) => item.type === "item");
  const boundary = menu.find((item) => item.id === "selection.boundary")!;
  expect(boundary).toBeDefined();
  expect(menu.map((item) => item.id)).not.toContain("selection.group");
  expect(menu.map((item) => item.id)).not.toContain("selection.add-to-boundary");
  expect(menu.map((item) => item.id)).not.toContain("selection.remove-from-boundary");
  expect(
    boundary.children
      ?.filter((item) => item.type === "item")
      .map((item) => item.id)
      .sort(),
  ).toEqual(["selection.add-to-boundary", "selection.group", "selection.remove-from-boundary"]);
  const palette = registry
    .build({ ...ctx, surface: "palette" })
    .filter((item) => item.type === "item")
    .map((item) => item.id);
  expect(palette).not.toContain("selection.boundary");
  for (const id of ["selection.group", "selection.add-to-boundary", "selection.remove-from-boundary"])
    expect(palette).toContain(id);
  expect(
    registry
      .build({ ...ctx, mode: "live" })
      .filter((item) => item.type === "item")
      .map((item) => item.id),
  ).not.toContain("selection.boundary");
});
