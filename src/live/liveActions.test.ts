import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { DiagramFile } from "../model/types";
import type { EditorApi } from "../editor/types";
import { ActionRegistry, type ActionContext, type MenuItem, type MenuNode } from "../editor/actions";
import { actionCommands } from "../palette/sources";
import { LiveController } from "./controller";
import { EXIT_SLOW_MOTION_HINT, liveActions, type LiveActionsHost } from "./liveActions";
import { faultDrillFixture } from "../lab/faultDrillFixture";

const diagram = JSON.parse(readFileSync("src/examples/kafka-order-pipeline.json", "utf8")) as DiagramFile;
const items = (rows: MenuNode[]): MenuItem[] =>
  rows.flatMap((r) => (r.type === "item" ? [r, ...items(r.children ?? [])] : []));

describe("live action availability during slow motion", () => {
  it.each(["menu", "palette"] as const)(
    "disables engine changes with a hint on %s, preserving read-only actions",
    (surface) => {
      let active = true;
      const controller = new LiveController(diagram);
      const host: LiveActionsHost = {
        controller,
        slowMotionActive: () => active,
        openInject: vi.fn(),
        startStorm: vi.fn(),
        showEvents: vi.fn(),
        trace: vi.fn(),
        tracing: () => null,
        traceNext: vi.fn(),
        traceSlowest: vi.fn(),
        traceDeadLettered: vi.fn(),
        slowMotion: vi.fn(),
        slowMotionTrace: vi.fn(),
        canReplayTrace: () => true,
        endTrace: vi.fn(),
        tracingMessage: () => true,
        saveTweaks: vi.fn(),
        messageType: () => "Order",
        openRecord: vi.fn(),
      };
      const registry = new ActionRegistry();
      registry.register(liveActions(host));
      const ctx: ActionContext = {
        target: "node",
        nodeId: "payments",
        mode: "live",
        surface,
        selection: { nodeIds: ["payments"], edgeIds: [], groupIds: [] },
        editor: {} as EditorApi,
      };
      const contexts = [ctx, { ...ctx, target: "canvas" as const }];
      const rows = contexts.flatMap((c) => items(registry.build(c)));
      for (const id of [
        "sim.kill",
        "sim.storm",
        "sim.inject",
        "sim.inject:1",
        "sim.pause",
        "sim.failure:0.5",
        "sim.slow:2",
        "sim.concurrency:2",
        "sim.inject-sources",
        "sim.traffic",
        "sim.reset",
      ]) {
        expect(
          rows.find((r) => r.id === id),
          id,
        ).toMatchObject({ disabled: true, hint: EXIT_SLOW_MOTION_HINT });
      }
      for (const id of ["sim.trace-next", "sim.events", "sim.record", "sim.trace-message:next"])
        expect(rows.find((r) => r.id === id)?.disabled, id).not.toBe(true);
      const commands = actionCommands(registry, contexts);
      expect(commands.find((c) => c.id === "action:sim.slow:2")?.label).toBe("Fault › Slow down › 2×");
      expect(commands.find((c) => c.id === "action:sim.failure:0.5")?.label).toBe("Fault › Fail › 50%");
      expect(commands.find((command) => command.id === "action:sim.kill")?.label).toBe("Fault › Take down");
      controller.setNodeStatus("payments", "down");
      expect(actionCommands(registry, contexts).find((command) => command.id === "action:sim.kill")?.label).toBe(
        "Fault › Restore",
      );
      controller.setNodeStatus("payments", "up");
      expect(commands.find((c) => c.id === "action:sim.failure:0.5")).toMatchObject({
        disabled: true,
        hint: EXIT_SLOW_MOTION_HINT,
      });
      expect(commands.find((c) => c.id === "action:sim.record")?.disabled).not.toBe(true);
      active = false;
      for (const c of contexts)
        for (const row of items(registry.build(c))) {
          expect(row.disabled).not.toBe(true);
          expect(row.hint).toBeUndefined();
        }
      controller.dispose();
    },
  );
});

it("keeps faults in one short contextual submenu, with guarded boundary and link restoration", () => {
  let held = false;
  const controller = new LiveController(faultDrillFixture());
  const host: LiveActionsHost = {
    controller,
    slowMotionActive: () => held,
    openInject: vi.fn(),
    startStorm: vi.fn(),
    showEvents: vi.fn(),
    trace: vi.fn(),
    tracing: () => null,
    traceNext: vi.fn(),
    traceSlowest: vi.fn(),
    traceDeadLettered: vi.fn(),
    slowMotion: vi.fn(),
    slowMotionTrace: vi.fn(),
    canReplayTrace: () => false,
    endTrace: vi.fn(),
    tracingMessage: () => false,
    saveTweaks: vi.fn(),
    messageType: () => "Job",
    openRecord: vi.fn(),
  };
  const registry = new ActionRegistry();
  registry.register(liveActions(host));
  const base: ActionContext = {
    target: "node",
    nodeId: "worker",
    mode: "live",
    editor: {} as EditorApi,
    selection: { nodeIds: [], edgeIds: [], groupIds: [] },
  };
  for (const ctx of [
    base,
    { ...base, target: "group" as const, groupId: "zone-b" },
    { ...base, target: "edge" as const, edgeId: "request" },
  ]) {
    const rows = registry.build(ctx).filter((r) => r.type === "item");
    const fault = rows.filter((r) => r.id === "sim.fault");
    expect(fault).toHaveLength(1);
    expect(fault[0].children!.length).toBeLessThanOrEqual(6);
    expect(rows.some((r) => ["sim.kill", "sim.slow", "sim.failure"].includes(r.id))).toBe(false);
    expect(items(registry.build({ ...ctx, mode: "edit" })).some((r) => r.id === "sim.fault")).toBe(false);
  }
  const boundary = { ...base, target: "group" as const, groupId: "zone-b" };
  held = true;
  const denied = items(registry.build(boundary)).find((r) => r.id === "sim.boundary-down")!;
  expect(denied.disabled).toBe(true);
  denied.run!();
  expect(controller.snapshot().nodes.worker.status).toBe("up");
  held = false;
  items(registry.build(boundary)).find((r) => r.id === "sim.boundary-down")!.run!();
  expect(controller.snapshot().nodes.worker.status).toBe("down");
  expect(items(registry.build(boundary)).find((r) => r.id === "sim.boundary-down")!.label).toBe("Restore");
  controller.setNodeStatus("worker", "down");
  const memberRestore = items(registry.build(base)).find((r) => r.id === "sim.kill")!;
  expect(memberRestore).toMatchObject({ disabled: true, hint: "Restore Zone b first." });
  memberRestore.run!();
  items(registry.build(boundary)).find((r) => r.id === "sim.boundary-down")!.run!();
  expect(controller.snapshot().nodes.worker.status).toBe("down");
  expect(items(registry.build({ ...base, target: "edge", edgeId: "write" })).some((r) => r.id === "sim.fault")).toBe(
    false,
  );
  const link = { ...base, target: "edge" as const, edgeId: "request" };
  items(registry.build(link)).find((r) => r.id === "sim.cut-link")!.run!();
  expect(items(registry.build(link)).find((r) => r.id === "sim.cut-link")!.label).toBe("Restore link");
  controller.dispose();
});

it.each(["menu", "palette"] as const)(
  "rechecks enclosing outages when an already-open %s Restore action runs",
  (surface) => {
    const controller = new LiveController(faultDrillFixture());
    const host: LiveActionsHost = {
      controller,
      slowMotionActive: () => false,
      openInject: vi.fn(),
      startStorm: vi.fn(),
      showEvents: vi.fn(),
      trace: vi.fn(),
      tracing: () => null,
      traceNext: vi.fn(),
      traceSlowest: vi.fn(),
      traceDeadLettered: vi.fn(),
      slowMotion: vi.fn(),
      slowMotionTrace: vi.fn(),
      canReplayTrace: () => false,
      endTrace: vi.fn(),
      tracingMessage: () => false,
      saveTweaks: vi.fn(),
      messageType: () => "Job",
      openRecord: vi.fn(),
    };
    const registry = new ActionRegistry();
    registry.register(liveActions(host));
    try {
      controller.setNodeStatus("worker", "down");
      const restore = items(
        registry.build({
          target: "node",
          nodeId: "worker",
          mode: "live",
          surface,
          editor: {} as EditorApi,
          selection: { nodeIds: ["worker"], edgeIds: [], groupIds: [] },
        }),
      ).find((row) => row.id === "sim.kill")!;
      expect(restore.label).toBe("Restore");
      expect(restore.disabled).not.toBe(true);
      controller.setFault({ kind: "boundary", boundary: "zone-b", down: true });
      restore.run!();
      controller.setFault({ kind: "boundary", boundary: "zone-b", down: false });
      expect(controller.snapshot().nodes.worker.status).toBe("down");
    } finally {
      controller.dispose();
    }
  },
);
