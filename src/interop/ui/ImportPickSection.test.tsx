import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { kedaLesson } from "../../model/autoscalingLessons";
import type { ImportPick } from "../infra/graph";
import { ImportPickSection } from "./ImportPickSection";

it.each([false, true])("only blocks an unchanged selection when all dependencies were drawn (%s)", (degraded) => {
  const pick: ImportPick = {
    format: "kubernetes",
    total: 3,
    groups: [
      { key: "workers", label: "Workers", nodes: 2, flows: 1, drawn: true },
      { key: "readers", label: "Readers", nodes: 1, flows: 1, drawn: false },
    ],
    selection: { keys: ["workers"], ...(degraded ? { unresolved: new Set(["worker"]) } : {}) },
    graph: {
      title: "Recovery",
      format: "Kubernetes",
      source: "test",
      notes: [],
      unread: [],
      notDrawn: [],
      groups: [
        { key: "workers", label: "Workers" },
        { key: "readers", label: "Readers" },
      ],
      components: [
        {
          key: "worker",
          label: "Worker",
          group: "workers",
          hint: { name: "worker" },
          props: { autoscaling: kedaLesson("kafka", { node: "topic", group: "readers" }) },
        },
        { key: "topic", label: "Topic", group: "workers", hint: { name: "topic" } },
        { key: "reader", label: "Reader", group: "readers", hint: { name: "reader" } },
      ],
      links: [
        { from: "topic", to: "reader", relation: "flow", props: { group: "readers" }, evidence: { source: "spec" } },
      ],
    },
  };
  const html = renderToStaticMarkup(createElement(ImportPickSection, { pick, onDraw() {} }));
  const button = html.match(/<button[^>]*data-testid="import-report-pick-draw"[^>]*>/)?.[0];
  expect(button).toBeDefined();
  expect(button!.includes('aria-disabled="true"')).toBe(!degraded);
  expect(html).toContain("Draw these (3 nodes)");
  if (degraded) expect(html).toContain("Drew 2 nodes, 0 connections and 1 boundary.");
});
