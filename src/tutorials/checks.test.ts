import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { holds, nearMiss, resolveSubjects } from "./checks";
import { mobileApi } from "./catalog/mobileApi";
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

it("binds overlapping subjects to distinct nodes and keeps their identities as diagram order changes", () => {
  const tutorial = {
    ...mobileApi,
    subjects: { first: { stencils: ["generic.service"] }, second: { role: "processor" as const } },
  };
  const one = diagram("Service");
  expect(resolveSubjects(tutorial, one)).toEqual({ first: "service-1", second: undefined });
  const two = { ...one, nodes: [...one.nodes, { ...one.nodes[0], id: "service-2" }] };
  const bindings = resolveSubjects(tutorial, two);
  expect(bindings).toEqual({ first: "service-1", second: "service-2" });
  expect(resolveSubjects(tutorial, { ...two, nodes: [...two.nodes].reverse() }, bindings)).toEqual(bindings);
  expect(
    holds({ kind: "edge", from: "first", to: "second" }, { diagram: two, live: false, processed: () => 0 }, bindings),
  ).toBe(false);
});
