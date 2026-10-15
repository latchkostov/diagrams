import { describe, expect, it } from "vitest";
import { nearestInDirection, readingOrder, stepInOrder, tabOrder, type NavBox } from "./keyboardNav";

const card = (id: string, x: number, y: number): NavBox => ({ id, x, y, width: 220, height: 72 });

// A 3 × 2 grid, with one slightly lower card in the first row:
//   a  b  c
//   d  e  f
const grid = [
  card("e", 400, 200),
  card("c", 800, 0),
  card("a", 0, 0),
  card("d", 0, 200),
  card("b", 400, 12),
  card("f", 800, 200),
];

describe("reading order (Tab)", () => {
  it("left to right: rows from the top, each row left to right", () => {
    expect(readingOrder(grid, "LR").map((b) => b.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("top to bottom: columns from the left, each column down the flow", () => {
    expect(readingOrder(grid, "TB").map((b) => b.id)).toEqual(["a", "d", "b", "e", "c", "f"]);
  });

  it("steps forward and back, and stops at either end", () => {
    const order = ["a", "b", "c"];
    expect(stepInOrder(order, "a")).toBe("b");
    expect(stepInOrder(order, "b", true)).toBe("a");
    expect(stepInOrder(order, "c")).toBeNull();
    expect(stepInOrder(order, "a", true)).toBeNull();
    // From nowhere: the first (Tab) or the last (Shift+Tab).
    expect(stepInOrder(order, undefined)).toBe("a");
    expect(stepInOrder(order, undefined, true)).toBe("c");
    expect(stepInOrder([], "a")).toBeNull();
  });
});

describe("the nearest node that way (Ctrl+Alt+arrows)", () => {
  const from = (id: string) => grid.find((b) => b.id === id)!;

  it("goes to the neighbour straight ahead", () => {
    expect(nearestInDirection(from("a"), grid, "right")).toBe("b");
    expect(nearestInDirection(from("a"), grid, "down")).toBe("d");
    expect(nearestInDirection(from("e"), grid, "up")).toBe("b");
    expect(nearestInDirection(from("e"), grid, "left")).toBe("d");
  });

  it("prefers the node in line over a nearer one off to the side", () => {
    const boxes = [card("o", 0, 0), card("side", 300, 160), card("ahead", 520, 0)];
    // "side" is nearer, but 160 px off the line counts double.
    expect(nearestInDirection(boxes[0], boxes, "right")).toBe("ahead");
  });

  it("never goes backwards, and says nothing is there at an edge", () => {
    expect(nearestInDirection(from("c"), grid, "right")).toBeNull();
    expect(nearestInDirection(from("a"), grid, "up")).toBeNull();
    expect(nearestInDirection(from("a"), grid, "left")).toBeNull();
  });

  it("outside the 45° cone, takes the nearest on that side", () => {
    // Only a node far below and a little to the right: → still reaches it.
    const boxes = [card("o", 0, 0), card("low", 100, 600)];
    expect(nearestInDirection(boxes[0], boxes, "right")).toBe("low");
  });
});

describe("Tab's order with boundaries", () => {
  it("meets a boundary just before the first of its members, an empty one where it reads", () => {
    const items = [card("api", 40, 80), card("worker", 380, 80), card("carrier", 1060, 80), card("ledger", 40, 260)];
    const pay = { ...card("group:pay", 0, 0), width: 640, height: 400, members: ["api", "worker", "ledger"] };
    const ship = { ...card("group:ship", 1000, 0), width: 600, height: 400, members: ["carrier"] };
    const empty = { ...card("group:empty", 0, 900), width: 300, height: 200, members: [] };
    expect(tabOrder(items, [pay, ship, empty])).toEqual([
      "group:pay",
      "api",
      "worker",
      "group:ship",
      "carrier",
      "ledger",
      "group:empty",
    ]);
  });
});

it.each(["LR", "TB"] as const)(
  "Tab meets ancestors before descendants in %s even without direct node members",
  (direction) => {
    const items = [card("node", 0, 0)];
    const child = { ...card("child", 100, 100), members: ["node"] };
    const parent = { ...card("parent", 200, 200), members: ["child"] };
    const emptyChild = { ...card("emptyChild", 400, 400), members: [] };
    const emptyParent = { ...card("emptyParent", 500, 500), members: ["emptyChild"] };
    expect(tabOrder(items, [child, parent, emptyChild, emptyParent], direction)).toEqual([
      "parent",
      "child",
      "node",
      "emptyParent",
      "emptyChild",
    ]);
  },
);
