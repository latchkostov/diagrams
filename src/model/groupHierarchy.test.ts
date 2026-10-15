import { describe, expect, it } from "vitest";
import {
  descendantGroupIds,
  ancestorGroupIds,
  wouldCreateCycle,
  eligibleParentGroupIds,
  planBoundaryAdoption,
  type GroupBox,
  type HierarchyElementBox,
} from "./groupHierarchy";

describe("groupHierarchy planner", () => {
  it("converting a centred enclosing zone preserves an acyclic hierarchy", () => {
    // Inner boundary centred at (250, 250)
    const innerBoundary: GroupBox = {
      id: "b-inner",
      x: 200,
      y: 200,
      width: 100,
      height: 100,
    };
    // Zone enclosing inner boundary, with centre at (250, 250)
    const zoneBounds = {
      x: 0,
      y: 0,
      width: 500,
      height: 500,
    };
    const nodeInInner: HierarchyElementBox = {
      id: "node-inner",
      x: 220,
      y: 220,
      width: 60,
      height: 40,
      group: "b-inner",
    };
    const nodeInZone: HierarchyElementBox = {
      id: "node-zone",
      x: 50,
      y: 50,
      width: 60,
      height: 40,
    };

    const plan = planBoundaryAdoption({
      bounds: zoneBounds,
      existingGroups: [innerBoundary],
      elements: [nodeInInner, nodeInZone],
    });

    // The new boundary has no parent (inner boundary cannot be its parent)
    expect(plan.outerGroupId).toBeUndefined();
    // Inner boundary is adopted as child
    expect(plan.adoptedGroupIds).toEqual(["b-inner"]);
    // Only node-zone is adopted; node-inner remains in b-inner
    expect(plan.adoptedElementIds).toEqual(["node-zone"]);
  });

  it("preserves existing nesting of enclosed boundaries", () => {
    // Outer boundary B1 and inner boundary B2 inside B1
    const b1: GroupBox = {
      id: "b1",
      x: 100,
      y: 100,
      width: 300,
      height: 300,
    };
    const b2: GroupBox = {
      id: "b2",
      x: 150,
      y: 150,
      width: 100,
      height: 100,
      group: "b1",
    };
    // New boundary wrapping both B1 and B2
    const bigZone = {
      x: 0,
      y: 0,
      width: 600,
      height: 600,
    };

    const plan = planBoundaryAdoption({
      bounds: bigZone,
      existingGroups: [b1, b2],
      elements: [],
    });

    expect(plan.outerGroupId).toBeUndefined();
    // Only top-level B1 is adopted directly into the new boundary; B2 remains inside B1
    expect(plan.adoptedGroupIds).toEqual(["b1"]);
  });

  it("selects enclosing parent group while excluding adopted children and descendants", () => {
    const rootContainer: GroupBox = {
      id: "root",
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
    };
    const innerChild: GroupBox = {
      id: "inner",
      x: 250,
      y: 250,
      width: 100,
      height: 100,
      group: "root",
    };
    const midZone = {
      x: 100,
      y: 100,
      width: 400,
      height: 400,
    };

    const plan = planBoundaryAdoption({
      bounds: midZone,
      existingGroups: [rootContainer, innerChild],
      elements: [],
    });

    // Outer group is root, innerChild is adopted as child
    expect(plan.outerGroupId).toBe("root");
    expect(plan.adoptedGroupIds).toEqual(["inner"]);
  });

  it("computes descendant and ancestor groups correctly", () => {
    const groups: GroupBox[] = [
      { id: "g1", x: 0, y: 0, width: 500, height: 500 },
      { id: "g2", x: 50, y: 50, width: 300, height: 300, group: "g1" },
      { id: "g3", x: 100, y: 100, width: 100, height: 100, group: "g2" },
      { id: "g-other", x: 600, y: 0, width: 200, height: 200 },
    ];

    expect([...descendantGroupIds("g1", groups)].sort()).toEqual(["g2", "g3"]);
    expect([...descendantGroupIds("g2", groups)]).toEqual(["g3"]);
    expect([...descendantGroupIds("g3", groups)]).toEqual([]);

    expect([...ancestorGroupIds("g3", groups)]).toEqual(["g2", "g1"]);
    expect([...ancestorGroupIds("g2", groups)]).toEqual(["g1"]);
    expect([...ancestorGroupIds("g1", groups)]).toEqual([]);

    expect(wouldCreateCycle("g1", "g3", groups)).toBe(true);
    expect(wouldCreateCycle("g1", "g1", groups)).toBe(true);
    expect(wouldCreateCycle("g3", "g1", groups)).toBe(false);
    expect(wouldCreateCycle("g3", "g-other", groups)).toBe(false);

    expect([...eligibleParentGroupIds("g1", groups)]).toEqual(["g-other"]);
    expect([...eligibleParentGroupIds("g2", groups)].sort()).toEqual(["g-other", "g1"]);
  });
});
