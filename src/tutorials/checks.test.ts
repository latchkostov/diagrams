import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { holds, nearMiss } from "./checks";
import type { Check } from "./types";

const diagram = (label: string): DiagramFile => ({
  format: "diagrams/v1",
  title: "t",
  nodes: [{ id: "service-1", stencil: "generic.service", label, x: 0, y: 0 }],
  edges: [],
});
const check: Check = { kind: "label", subject: "api", is: () => "Orders API" };
const subjects = { api: "service-1" };
const view = (label: string) => ({ diagram: diagram(label), live: false, processed: () => 0 });

describe("expectText (a label check) and its near miss", () => {
  it("matches ignoring case and outer spaces", () => {
    expect(holds(check, view("  orders api "), subjects)).toBe(true);
    expect(nearMiss(check, view("ORDERS API"), subjects)).toBeNull();
  });

  it("says what's expected when the learner's own name isn't it", () => {
    expect(holds(check, view("Order API"), subjects)).toBe(false);
    expect(nearMiss(check, view(" Order API "), subjects)).toEqual({ expected: "Orders API", typed: "Order API" });
  });

  it("isn't a near miss before any name of their own: empty, or the stencil's name", () => {
    expect(nearMiss(check, view(""), subjects)).toBeNull();
    expect(nearMiss(check, view("Service"), subjects)).toBeNull();
    expect(nearMiss(check, view("x"), {})).toBeNull();
    expect(nearMiss({ kind: "live" }, view("Order API"), subjects)).toBeNull();
  });
});
