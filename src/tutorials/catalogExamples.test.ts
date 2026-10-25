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

it("adds the prescribed setting idempotently and locks it without replacing existing settings", () => {
  const diagram = JSON.parse(readFileSync("src/examples/aks-app-config-key-vault.json", "utf8")) as DiagramFile;
  const subjects = resolveSubjects(dependencies2, diagram);
  const edge = diagram.edges.find((e) => e.from === subjects.api && e.to === subjects.config)!;
  const original = structuredClone(edge.props!.settings);
  const view = { diagram, live: false, processed: () => 0 };
  expect(holds(dependencies2.steps[1].check, view, subjects)).toBe(false);
  expect(holds(dependencies2.steps[2].check, view, subjects)).toBe(false);
  const add = dependencies2.steps[1].demo[0];
  const lock = dependencies2.steps[2].demo[0];
  if (add.kind !== "patch" || lock.kind !== "patch") throw new Error("Expected patch demos");
  const added = patchProps(edge.props, add.patches);
  expect(added).not.toBeNull();
  edge.props = { ...edge.props, ...added };
  expect(patchProps(edge.props, add.patches)).toBeNull();
  const settings = edge.props.settings as { key: string; secret?: boolean }[];
  expect(settings.slice(0, 4)).toEqual(original);
  expect(settings).toHaveLength(5);
  expect(holds(dependencies2.steps[1].check, view, subjects)).toBe(true);
  edge.props = { ...edge.props, ...patchProps(edge.props, lock.patches) };
  expect(patchProps(edge.props, lock.patches)).toBeNull();
  expect(holds(dependencies2.steps[2].check, view, subjects)).toBe(true);
  expect((edge.props.settings as unknown[]).slice(0, 4)).toEqual(original);
  expect((edge.props.settings as { key: string; secret?: boolean }[])[4]).toEqual({
    key: "Notifications:Token",
    secret: true,
  });
});

it("binds smsQueue to the outage channel", () => {
  const diagram = JSON.parse(readFileSync("src/examples/notification-fanout.json", "utf8")) as DiagramFile;
  const subjects = resolveSubjects(fanout, diagram);
  const outage = diagram.simulations!.find((sim) => sim.id === "sms-outage")!;
  const paused = outage.timeline!.find(
    (step) => step.action.do === "status" && step.action.status === "paused",
  )!.action;
  if (paused.do !== "status") throw new Error("Expected an outage status action");
  expect(diagram.edges.some((edge) => edge.from === subjects.smsQueue && edge.to === paused.node)).toBe(true);
  const waiting = outage.expectations!.find((expectation) => expectation.id === "waiting")!;
  expect(waiting.metric).toMatchObject({ node: subjects.smsQueue });
  expect(subjects.smsQueue).not.toBe(subjects.emailQueue);
  expect(subjects.smsQueue).not.toBe("push-q");
});

it("finds the prescribed setting before existing rows and never accepts a different fifth key", () => {
  const diagram = JSON.parse(readFileSync("src/examples/aks-app-config-key-vault.json", "utf8")) as DiagramFile;
  const subjects = resolveSubjects(dependencies2, diagram);
  const edge = diagram.edges.find((e) => e.from === subjects.api && e.to === subjects.config)!;
  const original = structuredClone(edge.props!.settings) as { key: string; secret?: boolean }[];
  const view = { diagram, live: false, processed: () => 0 };
  const add = dependencies2.steps.find((step) => step.id === "add-setting")!;
  const lock = dependencies2.steps.find((step) => step.id === "mark-secret")!;
  edge.props = { ...edge.props, settings: [{ key: "Custom:Token" }, ...original] };
  expect(holds(add.check, view, subjects)).toBe(false);
  edge.props.settings = [{ key: "Notifications:Token" }, ...original];
  expect(holds(add.check, view, subjects)).toBe(true);
  expect(holds(lock.check, view, subjects)).toBe(false);
  const demo = lock.demo[0];
  if (demo.kind !== "patch") throw new Error("Expected a patch demo");
  edge.props = { ...edge.props, ...patchProps(edge.props, demo.patches) };
  expect(holds(lock.check, view, subjects)).toBe(true);
  expect(edge.props.settings).toEqual([{ key: "Notifications:Token", secret: true }, ...original]);
});
