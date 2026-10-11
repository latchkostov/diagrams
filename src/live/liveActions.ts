// Context-menu entries for the live view, registered in the "simulation" section of the action
// registry while live mode is on. They change the running engine only; "Save to diagram" is the
// explicit way to keep a tweak.

import type { Action, MenuNode } from "../editor/actions";
import type { NodeStatus } from "../sim/types";
import { resolveProps } from "../sim/defaults";
import type { LiveController } from "./controller";
import { formatPercent } from "./format";
import type { XY } from "../editor/types";

export interface LiveActionsHost {
  controller: LiveController;
  /** "Custom…" injection: opens the small inject dialog at a screen point. */
  openInject(nodeId: string, at: XY | undefined): void;
  /** "Start a storm here…". */
  startStorm(nodeId: string): void;
  showEvents(nodeId: string | null): void;
  trace(edgeId: string | null): void;
  tracing(): string | null;
  /** Writes a node's live tweaks into the diagram (undoable). */
  saveTweaks(nodeId: string): void;
  messageType(nodeId: string): string;
}

const FAILURE_RATES = [0, 0.1, 0.25, 0.5, 1];
const SLOWDOWNS = [1, 2, 5, 10];
const CONCURRENCY = [1, 2, 4, 8, 16, 64];

/** Reserve room for the Simulation submenu without dropping editing actions. */
export function compactLiveNodeMenu(items: MenuNode[]): MenuNode[] {
  const clipboardIds = new Set(["item.duplicate", "item.copy", "item.cut"]);
  const clipboard = items.filter((item) => item.type === "item" && clipboardIds.has(item.id));
  if (clipboard.length < 2) return items;
  let placed = false;
  return items.flatMap((item): MenuNode[] => {
    if (item.type !== "item" || !clipboardIds.has(item.id)) return [item];
    if (placed) return [];
    placed = true;
    return [{ type: "item", id: "live.clipboard", label: "Clipboard", icon: "copy", children: clipboard }];
  });
}

export function liveActions(host: LiveActionsHost): Action[] {
  const c = host.controller;
  const status = (id: string): NodeStatus => c.snapshot().nodes[id]?.status ?? "up";
  const role = (id: string) => c.snapshot().nodes[id]?.role ?? "none";
  const props = (id: string) => {
    const node = c.currentDiagram.nodes.find((n) => n.id === id);
    return resolveProps(role(id), node?.label ?? id, c.effectiveProps(id));
  };
  const baseLatency = (id: string) => {
    const node = c.currentDiagram.nodes.find((n) => n.id === id);
    const raw = { ...node?.props, ...c.getState().simulation?.setup?.props?.[id] };
    return resolveProps(role(id), node?.label ?? id, raw).latencyMs || 250;
  };
  const isNode = (id: string | undefined): id is string => !!id && !!c.snapshot().nodes[id];

  const actions: Action[] = [
    {
      id: "sim.inject",
      section: "simulation",
      targets: ["node"],
      label: "Inject",
      icon: "bolt",
      order: 10,
      when: (ctx) => isNode(ctx.nodeId),
      children: (ctx) => {
        const id = ctx.nodeId!;
        const type = host.messageType(id);
        const rows: MenuNode[] = [{ type: "header", label: type }];
        for (const n of [1, 10, 100]) {
          rows.push({
            type: "item",
            id: `sim.inject:${n}`,
            label: n === 1 ? "1 message" : `${n} messages`,
            run: () => c.inject(id, n, { type, spreadMs: n > 10 ? 1500 : 0 }),
          });
        }
        rows.push(
          { type: "separator" },
          { type: "item", id: "sim.inject:custom", label: "Custom…", run: () => host.openInject(id, ctx.point) },
        );
        return rows;
      },
    },
    {
      id: "sim.storm",
      section: "simulation",
      targets: ["node"],
      label: "Start a storm here…",
      icon: "sparkle",
      order: 20,
      when: (ctx) => isNode(ctx.nodeId),
      run: (ctx) => host.startStorm(ctx.nodeId!),
    },
    {
      id: "sim.kill",
      section: "simulation",
      targets: ["node"],
      label: (ctx) => (status(ctx.nodeId!) === "down" ? "Revive" : "Kill"),
      icon: "close",
      danger: true,
      order: 30,
      when: (ctx) => isNode(ctx.nodeId),
      run: (ctx) => c.setNodeStatus(ctx.nodeId!, status(ctx.nodeId!) === "down" ? "up" : "down"),
    },
    {
      // Everything else about a node's live behaviour sits one level down (menus stay short).
      id: "sim.behaviour",
      section: "simulation",
      targets: ["node"],
      label: "Behaviour",
      icon: "sliders",
      order: 40,
      when: (ctx) => isNode(ctx.nodeId),
      children: (ctx) => {
        const id = ctx.nodeId!;
        const r = role(id);
        const p = props(id);
        const rows: MenuNode[] = [];
        if (status(id) !== "down") {
          rows.push({
            type: "item",
            id: "sim.pause",
            label: status(id) === "paused" ? "Resume" : "Pause",
            run: () => c.setNodeStatus(id, status(id) === "paused" ? "up" : "paused"),
          });
        }
        if (r === "processor") {
          rows.push({
            type: "item",
            id: "sim.failure",
            label: "Failure rate",
            children: FAILURE_RATES.map((f) => ({
              type: "item",
              id: `sim.failure:${f}`,
              label: f === 0 ? "Never fails" : f === 1 ? "Always fails (100%)" : formatPercent(f),
              checked: Math.abs(p.failureRate - f) < 1e-9,
              run: () => c.setNodeProps(id, { failureRate: f }),
            })),
          });
        }
        if (r === "processor" || r === "gateway" || r === "store") {
          const base = baseLatency(id);
          rows.push({
            type: "item",
            id: "sim.slow",
            label: "Slow down",
            children: SLOWDOWNS.map((f) => ({
              type: "item",
              id: `sim.slow:${f}`,
              label: f === 1 ? `Normal (${Math.round(base)} ms)` : `Latency ×${f} (${Math.round(base * f)} ms)`,
              checked: Math.abs(p.latencyMs - base * f) < 0.5,
              run: () => c.setNodeProps(id, { latencyMs: base * f }),
            })),
          });
        }
        if (r === "processor") {
          rows.push({
            type: "item",
            id: "sim.concurrency",
            label: "Concurrency",
            children: CONCURRENCY.map((n) => ({
              type: "item",
              id: `sim.concurrency:${n}`,
              label: n === 1 ? "1 worker" : `${n} workers`,
              checked: p.concurrency === n,
              run: () => c.setNodeProps(id, { concurrency: n }),
            })),
          });
        }
        rows.push(
          { type: "separator" },
          { type: "item", id: "sim.events", label: "Show events for this node", run: () => host.showEvents(id) },
        );
        if (c.getState().tweaks.has(id)) {
          rows.push({
            type: "item",
            id: "sim.save-tweaks",
            label: "Save live changes to diagram",
            run: () => host.saveTweaks(id),
          });
        }
        return rows;
      },
    },
    {
      id: "sim.trace",
      section: "simulation",
      targets: ["edge"],
      label: (ctx) => (host.tracing() === ctx.edgeId ? "Clear trace" : "Trace this path"),
      icon: "route",
      order: 10,
      when: (ctx) => !!ctx.edgeId,
      run: (ctx) => host.trace(host.tracing() === ctx.edgeId ? null : ctx.edgeId!),
    },
    {
      id: "sim.inject-sources",
      section: "simulation",
      targets: ["canvas"],
      label: "Inject 10 at every entry point",
      icon: "bolt",
      order: 10,
      run: () => c.injectAtSources(10),
    },
    {
      id: "sim.traffic",
      section: "simulation",
      targets: ["canvas"],
      label: "Continuous traffic",
      icon: "swap",
      order: 20,
      checked: () => c.getState().traffic,
      run: () => c.setTraffic(!c.getState().traffic),
    },
    {
      id: "sim.clear-trace",
      section: "simulation",
      targets: ["canvas"],
      label: "Clear trace",
      icon: "route",
      order: 30,
      when: () => host.tracing() !== null,
      run: () => host.trace(null),
    },
    {
      id: "sim.reset",
      section: "simulation",
      targets: ["canvas"],
      label: "Reset simulation",
      icon: "reset",
      order: 40,
      run: () => c.restart(),
    },
  ];
  const nodeActions = actions.filter((action) => action.targets.includes("node"));
  return [
    {
      id: "sim.node",
      section: "simulation",
      targets: ["node"],
      label: "Simulation",
      icon: "bolt",
      order: 10,
      when: (ctx) => isNode(ctx.nodeId),
      children: (ctx) =>
        nodeActions
          .filter((action) => !action.when || action.when(ctx))
          .map((action) => ({
            type: "item",
            id: action.id,
            label: typeof action.label === "function" ? action.label(ctx) : action.label,
            icon: action.icon,
            danger: action.danger,
            children: action.children?.(ctx),
            run: action.run ? () => action.run!(ctx) : undefined,
          })),
    },
    ...actions.filter((action) => !action.targets.includes("node")),
  ];
}
