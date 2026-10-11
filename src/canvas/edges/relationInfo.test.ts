import { expect, it } from "vitest";
import { relationInfo } from "./relationInfo";
import type { DiagramFlowEdge } from "../types";

it("indexes config settings once and reuses reference lists for labels and cards", () => {
  let reads = 0;
  const settings = [
    {
      get key() {
        reads++;
        return "ApiKey";
      },
      secret: true,
    },
  ];
  const edges: DiagramFlowEdge[] = [
    { id: "config", source: "app", target: "store", data: { kind: "async", relation: "config", props: { settings } } },
    ...Array.from({ length: 100 }, (_, i): DiagramFlowEdge => ({
      id: `secret${i}`,
      source: "store",
      target: `vault${i}`,
      data: { kind: "async", relation: "secret" },
    })),
  ];
  const info = relationInfo(edges);
  expect(reads).toBe(1);
  expect(info.get("config")?.text).toBe("1 setting · 1 secret");
  for (let i = 0; i < 100; i++) {
    expect(info.get(`secret${i}`)?.text).toBe("1 reference");
    expect(info.get(`secret${i}`)?.settings).toBe(info.get("secret0")?.settings);
  }
});

it("preserves unchanged dependency metadata across selection and unrelated edits", () => {
  const edges: DiagramFlowEdge[] = [
    {
      id: "c",
      source: "app",
      target: "store",
      data: { kind: "async", relation: "config", props: { settings: [{ key: "A" }] } },
    },
  ];
  const before = relationInfo(edges).get("c");
  expect(relationInfo(edges.map((e) => ({ ...e, selected: true }))).get("c")).toBe(before);
  expect(relationInfo([...edges, { id: "f", source: "a", target: "b" }]).get("c")).toBe(before);
  const changed = relationInfo([
    { ...edges[0], data: { kind: "async", ...edges[0].data, props: { settings: [{ key: "B" }] } } },
  ]).get("c");
  expect(changed).not.toBe(before);
  expect(changed?.settings).toEqual([{ key: "B" }]);
});
