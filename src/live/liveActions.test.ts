import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { DiagramFile } from "../model/types";
import type { EditorApi } from "../editor/types";
import { ActionRegistry, type ActionContext, type MenuItem, type MenuNode } from "../editor/actions";
import { actionCommands } from "../palette/sources";
import { LiveController } from "./controller";
import { EXIT_SLOW_MOTION_HINT, liveActions, type LiveActionsHost } from "./liveActions";

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
      expect(commands.find((command) => command.id === "action:sim.kill")?.label).toBe("Kill node");
      controller.setNodeStatus("payments", "down");
      expect(actionCommands(registry, contexts).find((command) => command.id === "action:sim.kill")?.label).toBe(
        "Revive node",
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
