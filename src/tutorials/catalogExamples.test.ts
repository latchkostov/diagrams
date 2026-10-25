import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { dependencies2 } from "./catalog/dependencies2";
import { fanout } from "./catalog/fanout";
import { holds, resolveSubjects } from "./checks";
import { patchProps } from "./paths";

it("binds the SMS connection by its public example's stencils and endpoints", () => {
  const diagram = JSON.parse(readFileSync("src/examples/notification-fanout.json", "utf8")) as DiagramFile;
  const subjects = resolveSubjects(fanout, diagram);
  const edge = diagram.edges.find((e) => e.from === subjects.router && e.to === subjects.smsQueue);
  expect(edge).toBeDefined();
  expect(diagram.edges.find((e) => e.from === subjects.smsQueue && e.props?.dlq)?.to).toBeDefined();
  expect(edge?.props?.filter).toBeUndefined();
});

it("starts with four settings, adds one without replacing them, and can lock a learner's own fifth key", () => {
  const diagram = JSON.parse(readFileSync("src/examples/aks-app-config-key-vault.json", "utf8")) as DiagramFile;
  const subjects = resolveSubjects(dependencies2, diagram);
  const edge = diagram.edges.find((e) => e.from === subjects.api && e.to === subjects.config)!;
  const original = structuredClone(edge.props!.settings);
  const view = { diagram, live: false, processed: () => 0 };
  expect(holds(dependencies2.steps[0].check, view, subjects)).toBe(false);
  expect(holds(dependencies2.steps[1].check, view, subjects)).toBe(false);
  const add = dependencies2.steps[0].demo[0];
  const lock = dependencies2.steps[1].demo[0];
  if (add.kind !== "patch" || lock.kind !== "patch") throw new Error("Expected patch demos");
  const added = patchProps(edge.props, add.patches);
  expect(added).not.toBeNull();
  edge.props = { ...edge.props, ...added };
  expect(patchProps(edge.props, add.patches)).toBeNull();
  const settings = edge.props.settings as { key: string; secret?: boolean }[];
  expect(settings.slice(0, 4)).toEqual(original);
  expect(settings).toHaveLength(5);
  expect(holds(dependencies2.steps[0].check, view, subjects)).toBe(true);
  settings[4].key = "Custom:Token";
  edge.props = { ...edge.props, ...patchProps(edge.props, lock.patches) };
  expect(patchProps(edge.props, lock.patches)).toBeNull();
  expect(holds(dependencies2.steps[1].check, view, subjects)).toBe(true);
  expect((edge.props.settings as unknown[]).slice(0, 4)).toEqual(original);
  expect((edge.props.settings as { key: string; secret?: boolean }[])[4]).toEqual({
    key: "Custom:Token",
    secret: true,
  });
});
