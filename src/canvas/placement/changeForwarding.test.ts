import { expect, it, vi } from "vitest";
import type { EdgeChange, NodeChange } from "@xyflow/react";
import { selectionChanges } from "./changeForwarding";

it("forwards measurements and click selection while leaving box selection to its owner", () => {
  let userSelectionActive = false;
  const store = { getState: () => ({ userSelectionActive }) };
  const menus = { selecting: vi.fn() };
  const measurement: NodeChange = { type: "dimensions", id: "a", dimensions: { width: 220, height: 72 } };
  const nodeSelection: NodeChange = { type: "select", id: "a", selected: true };
  const edgeSelection: EdgeChange = { type: "select", id: "ab", selected: true };
  expect(selectionChanges(store, menus, [measurement])).toEqual([measurement]);
  expect(menus.selecting).not.toHaveBeenCalled();
  expect(selectionChanges(store, menus, [nodeSelection])).toEqual([nodeSelection]);
  expect(selectionChanges(store, menus, [edgeSelection])).toEqual([edgeSelection]);
  expect(menus.selecting.mock.calls).toEqual([["click"], ["click"]]);
  userSelectionActive = true;
  expect(selectionChanges(store, menus, [nodeSelection, measurement])).toEqual([measurement]);
  expect(selectionChanges(store, menus, [edgeSelection])).toEqual([]);
  expect(menus.selecting).toHaveBeenCalledTimes(2);
});
