import { describe, expect, it } from "vitest";
import {
  BOUNDARY_LABEL_ROOM,
  BOUNDARY_PAD,
  groupAtPoint,
  growToHold,
  growthBlocked,
  membershipAfterResize,
  previewMembership,
  settleMembership,
  type GroupRect,
  type MemberBox,
} from "./membership";

// A boundary at (0, 0) 600 × 400; nodes are 220 × 72 cards.
const pay: GroupRect = { id: "pay", x: 0, y: 0, width: 600, height: 400 };
const card = (id: string, x: number, y: number, group?: string): MemberBox => ({
  id,
  x,
  y,
  width: 220,
  height: 72,
  group,
});

describe("membership: the node's centre decides", () => {
  it("the smallest boundary around a point holds it", () => {
    const inner: GroupRect = { id: "inner", x: 40, y: 40, width: 300, height: 200 };
    expect(groupAtPoint([pay, inner], 100, 100)).toBe("inner");
    expect(groupAtPoint([pay, inner], 500, 300)).toBe("pay");
    expect(groupAtPoint([pay, inner], 700, 300)).toBeUndefined();
  });

  it("a member whose centre is still inside stays; one whose centre crossed out leaves", () => {
    const pokes = card("a", 480, 100, "pay"); // centre x 590: inside, the card pokes 100 px out
    const out = card("b", 520, 100, "pay"); // centre x 630: outside
    const s = settleMembership([pokes, out], [pay], []);
    expect(s.group.get("a")).toBe("pay");
    expect(s.group.get("b")).toBeUndefined();
    expect(s.left.get("pay")).toEqual(["b"]);
  });

  it("a node dropped with its centre inside joins", () => {
    const s = settleMembership([card("c", 300, 250)], [pay], []);
    expect(s.group.get("c")).toBe("pay");
    expect(s.left.size).toBe(0);
  });
});

describe("growth: a boundary grows to hold a member that pokes out, never shrinks", () => {
  it("leaves a boundary that already holds the node alone", () => {
    expect(growToHold(pay, card("a", 100, 100))).toBeNull();
  });

  it("grows by the usual padding on the side it pokes out, onto the grid", () => {
    const g = growToHold(pay, card("a", 480, 100))!;
    expect(g.x).toBe(0);
    expect(g.y).toBe(0);
    expect(g.height).toBe(400);
    // Right edge: the card's right (700) plus the padding.
    expect(g.x + g.width).toBe(700 + BOUNDARY_PAD);
  });

  it("keeps room for the label above a node poking out at the top", () => {
    const g = growToHold(pay, card("a", 100, 0))!;
    // The card's top sits in the label row: the boundary's top moves up to leave padding and the label.
    expect(g.y).toBe(Math.floor((0 - BOUNDARY_PAD - BOUNDARY_LABEL_ROOM) / 10) * 10);
    expect(g.y + g.height).toBe(400);
  });

  it("moves only the sides the node pokes out of", () => {
    // Pokes out on the right, 40 px below the top (less than the padding and label row): the top stays.
    const g = growToHold(pay, card("a", 480, 40))!;
    expect(g.y).toBe(0);
    expect(g.x).toBe(0);
    expect(g.height).toBe(400);
  });

  it("only ever grows: every side stays or moves out", () => {
    const g = growToHold(pay, card("a", -150, 380))!;
    expect(g.x).toBeLessThanOrEqual(pay.x);
    expect(g.y).toBeLessThanOrEqual(pay.y);
    expect(g.x + g.width).toBeGreaterThanOrEqual(pay.x + pay.width);
    expect(g.y + g.height).toBeGreaterThanOrEqual(pay.y + pay.height);
    // And holds the card with its padding.
    expect(g.x).toBeLessThanOrEqual(-150 - BOUNDARY_PAD);
    expect(g.y + g.height).toBeGreaterThanOrEqual(380 + 72 + BOUNDARY_PAD);
  });

  it("several members poking out grow it once, to hold them all", () => {
    const s = settleMembership([card("a", 480, 20, "pay"), card("b", 100, 360, "pay")], [pay], []);
    const g = s.grow.get("pay")!;
    expect(g.x + g.width).toBe(740);
    // Onto the grid: 360 + 72 + 40 = 472, so 480.
    expect(g.y + g.height).toBe(Math.ceil((360 + 72 + BOUNDARY_PAD) / 10) * 10);
  });
});

describe("Tidy up keeps members in their boundary", () => {
  it("grows the boundary to hold a member that landed outside it, instead of letting it go", () => {
    const s = settleMembership([card("a", 700, 100, "pay")], [pay], [], true);
    expect(s.group.get("a")).toBe("pay");
    expect(s.left.size).toBe(0);
    expect(s.grow.get("pay")!.x + s.grow.get("pay")!.width).toBe(700 + 220 + BOUNDARY_PAD);
  });
});

describe("growth never lands on a neighbour", () => {
  const ship: GroupRect = { id: "ship", x: 660, y: 0, width: 400, height: 400 };

  it("is blocked by another boundary it would newly cover", () => {
    const grown = growToHold(pay, card("a", 480, 100))!;
    expect(growthBlocked(pay, grown, [pay, ship], [])).toBe(true);
    const s = settleMembership([card("a", 480, 100, "pay")], [pay, ship], []);
    expect(s.blocked.has("pay")).toBe(true);
    expect(s.grow.has("pay")).toBe(false);
    // Still a member: the centre decides membership; the boundary just doesn't grow.
    expect(s.group.get("a")).toBe("pay");
  });

  it("is blocked by a node that isn't a member, but not by its own members", () => {
    const outsider = card("x", 720, 100);
    const member = card("m", 300, 300, "pay");
    const s = settleMembership([card("a", 480, 100, "pay")], [pay], [outsider, member]);
    expect(s.blocked.has("pay")).toBe(true);
    const ok = settleMembership([card("a", 480, 100, "pay")], [pay], [member]);
    expect(ok.grow.has("pay")).toBe(true);
  });

  it("what it already covered doesn't count (a boundary nested in it)", () => {
    const nested: GroupRect = { id: "nested", x: 40, y: 200, width: 200, height: 150 };
    const grown = growToHold(pay, card("a", 480, 100))!;
    expect(growthBlocked(pay, grown, [pay, nested], [])).toBe(false);
  });
});

describe("the drag's preview", () => {
  it("shows the boundary a node joins, the one it leaves, and the one that holds it", () => {
    const ship: GroupRect = { id: "ship", x: 800, y: 0, width: 400, height: 400 };
    const joining = previewMembership([card("a", 900, 100, "pay")], [pay, ship], []);
    expect(joining.get("ship")).toBe("join");
    expect(joining.get("pay")).toBe("leave");
    const staying = previewMembership([card("a", 100, 100, "pay")], [pay, ship], []);
    expect(staying.get("pay")).toBe("hold");
    expect(staying.has("ship")).toBe(false);
  });

  it("shows a boundary that can't grow as blocked", () => {
    const ship: GroupRect = { id: "ship", x: 660, y: 0, width: 400, height: 400 };
    const p = previewMembership([card("a", 480, 100, "pay")], [pay, ship], []);
    expect(p.get("pay")).toBe("blocked");
  });
});

describe("resizing a boundary adopts and releases nodes", () => {
  it("adopts nodes now inside it and releases members now outside it", () => {
    const smaller: GroupRect = { ...pay, width: 300 };
    const r = membershipAfterResize(
      "pay",
      [card("in", 20, 100, "pay"), card("out", 400, 100, "pay"), card("new", 50, 250), card("far", 900, 0)],
      [smaller],
    );
    expect(r.released).toEqual(["out"]);
    expect(r.adopted).toEqual(["new"]);
    expect(r.group.get("out")).toBeUndefined();
    expect(r.group.get("new")).toBe("pay");
    expect(r.group.has("in")).toBe(false);
    expect(r.group.has("far")).toBe(false);
  });

  it("a member released by one boundary lands in the one around it", () => {
    const outer: GroupRect = { id: "outer", x: -100, y: -100, width: 1200, height: 800 };
    const r = membershipAfterResize("pay", [card("out", 700, 100, "pay")], [pay, outer]);
    expect(r.group.get("out")).toBe("outer");
  });
});
