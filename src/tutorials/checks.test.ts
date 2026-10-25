import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { fillTestId, holds, nearMiss, resolveSubjects, edgeTargets } from "./checks";
import { mobileApi } from "./catalog/mobileApi";
import type { Check, PropPath } from "./types";

const diagram = (label: string): DiagramFile => ({
  format: "diagrams/v1",
  title: "t",
  nodes: [{ id: "service-1", stencil: "generic.service", label, x: 0, y: 0 }],
  edges: [],
});
const check: Check = { kind: "label", subject: "api", is: () => "Orders API" };
const subjects = { api: "service-1" };
const view = (label: string) => ({ diagram: diagram(label), live: false, processed: () => 0 });

it("resolves edge targets by endpoint subjects even when the saved edge has an unrelated id", () => {
  const d = { ...diagram("API"), edges: [{ id: "arbitrary", from: "service-1", to: "store", kind: "async" as const }] };
  const bindings = { api: "service-1", config: "store", missing: undefined };
  const targets = edgeTargets(d, bindings);
  expect(fillTestId("edge-label-{api->config}", bindings, targets)).toBe("edge-label-arbitrary");
  expect(fillTestId("edge-label-{config->api}", bindings, targets)).toBeNull();
  expect(fillTestId("node-{missing}", bindings, targets)).toBeNull();
  expect(fillTestId("node-{api}", bindings, targets)).toBe("node-service-1");
});

it("checks settings length and a setting's secret flag without accepting missing or inherited paths", () => {
  const v = view("API");
  v.diagram.nodes[0].props = { settings: [{ key: "Token", secret: true }] };
  expect(
    holds({ kind: "prop", subject: "api", prop: ["settings"], measure: "length", op: ">=", value: 1 }, v, subjects),
  ).toBe(true);
  expect(
    holds({ kind: "prop", subject: "api", prop: ["settings", 0, "secret"], op: "=", value: true }, v, subjects),
  ).toBe(true);
  for (const prop of [["settings", 1, "secret"], ["missing"], ["settings", "constructor"]] satisfies PropPath[]) {
    expect(holds({ kind: "prop", subject: "api", prop, op: ">=", value: 1 }, v, subjects)).toBe(false);
  }
});

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

it("resolves edge subjects after their nodes and retains edge identity across a reconnect", () => {
  const tutorial = { ...mobileApi, subjects: { link: { edge: ["app", "api"] as const }, ...mobileApi.subjects } };
  const d: DiagramFile = {
    ...diagram("Service"),
    nodes: [{ id: "client", stencil: "client.mobile", label: "", x: 0, y: 0 }, ...diagram("Service").nodes],
    edges: [{ id: "call", from: "client", to: "service-1", kind: "sync" }],
  };
  const bindings = resolveSubjects(tutorial, d);
  expect(bindings).toEqual({ app: "client", api: "service-1", link: "call" });
  expect(resolveSubjects(tutorial, { ...d, edges: [{ ...d.edges[0], to: "other" }] }, bindings).link).toBe("call");
  expect(resolveSubjects(tutorial, { ...d, edges: [] }, bindings).link).toBeUndefined();
});
