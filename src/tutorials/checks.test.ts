import { initialEditorMode } from "../canvas/interaction/mode";
import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { fillTestId, holds, nearMiss, resolveSubjects, edgeTargets } from "./checks";
import { mobileApi } from "./catalog/mobileApi";
import { backlogLag } from "./catalog/backlogLag";
import type { Check, PropPath } from "./types";
import { membershipFixture } from "../test/tutorialFixtures";

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

it("requires every selected member and rebinds boundaries after membership changes", () => {
  if (typeof membershipFixture.start !== "function") throw new Error("Expected inline sandbox");
  const d = membershipFixture.start();
  d.groups = [
    { id: "old", label: "", x: 200, y: -80, width: 600, height: 300 },
    { id: "new", label: "", x: 200, y: 400, width: 600, height: 300 },
  ];
  const one = d.nodes.find((n) => n.id === "one")!;
  const two = d.nodes.find((n) => n.id === "two")!;
  one.group = "old";
  let bindings = resolveSubjects(membershipFixture, d);
  expect(bindings.firstCell).toBeUndefined();
  two.group = "new";
  expect(resolveSubjects(membershipFixture, d, bindings).firstCell).toBeUndefined();
  two.group = "old";
  bindings = resolveSubjects(membershipFixture, d, bindings);
  expect(bindings.firstCell).toBe("old");
  one.group = "new";
  expect(resolveSubjects(membershipFixture, d, bindings).firstCell).toBeUndefined();
  two.group = "new";
  bindings = resolveSubjects(membershipFixture, d, bindings);
  expect(bindings.firstCell).toBe("new");
  d.nodes = d.nodes.filter((n) => n.id !== "two");
  expect(resolveSubjects(membershipFixture, d, bindings).firstCell).toBeUndefined();
});

it("retains order-based boundary bindings for existing lessons", () => {
  const tutorial = {
    ...mobileApi,
    subjects: { first: { boundary: true as const }, second: { boundary: true as const } },
  };
  const d = diagram("");
  d.groups = ["a", "b"].map((id) => ({ id, label: "", x: 0, y: 0, width: 300, height: 200 }));
  const bindings = resolveSubjects(tutorial, d);
  expect(bindings).toEqual({ first: "a", second: "b" });
  d.groups.reverse();
  expect(resolveSubjects(tutorial, d, bindings)).toEqual(bindings);
});

it("binds a downstream subject only to a flow consumer, including after its old consumer disconnects", () => {
  if (typeof backlogLag.start !== "function") throw new Error("Expected inline sandbox");
  const d = backlogLag.start();
  const service = diagram("Service").nodes[0];
  d.nodes.push(service, { ...service, id: "consumer" });
  d.edges.push({ id: "reads", from: "queue", to: "consumer", kind: "async" });
  const bindings = resolveSubjects(backlogLag, d);
  expect(bindings.worker).toBe("consumer");
  d.edges.push({ id: "config", from: "queue", to: service.id, kind: "sync", relation: "config" });
  expect(resolveSubjects(backlogLag, d, bindings).worker).toBe("consumer");
  d.edges = d.edges.filter((e) => e.id !== "reads");
  expect(resolveSubjects(backlogLag, d, bindings).worker).toBeUndefined();
  d.edges.push({ id: "new-reader", from: "queue", to: service.id, kind: "async" });
  expect(resolveSubjects(backlogLag, d, bindings).worker).toBe(service.id);
});

it("alignment ignores selected edges before checking the minimum node count", () => {
  const d: DiagramFile = {
    ...diagram(""),
    nodes: Array.from({ length: 4 }, (_, i) => ({
      id: `n${i}`,
      stencil: "generic.service",
      label: "",
      x: i * 200,
      y: 50,
    })),
    edges: [{ id: "edge", from: "n0", to: "n1", kind: "sync" }],
  };
  const check: Check = { kind: "aligned", axis: "y", atLeast: 4 };
  const selection = d.nodes.map((n) => n.id).concat("edge");
  const v = { diagram: d, live: false, processed: () => 0, mode: { ...initialEditorMode, selection } };
  expect(holds(check, v, {})).toBe(true);
  expect(holds(check, { ...v, mode: { ...v.mode, selection: selection.slice(1) } }, {})).toBe(false);
  expect(holds(check, { ...v, diagram: { ...d, nodes: d.nodes.map((n, i) => ({ ...n, y: i })) } }, {})).toBe(false);
});
