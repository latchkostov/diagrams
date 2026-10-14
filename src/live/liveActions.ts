// Context-menu entries for the live view, registered in the "simulation" section of the action
// registry while live mode is on (and offered only in the "live" mode). They change the running engine only; "Save to diagram" is the
// explicit way to keep a tweak.

import type { Action, MenuNode } from "../editor/actions";
import type { NodeStatus } from "../sim/types";
import { resolveProps } from "../sim/defaults";
import type { LiveController } from "./controller";
import { formatPercent } from "./format";
import type { XY } from "../editor/types";

export interface LiveActionsHost {
  controller: LiveController;
  slowMotionActive(): boolean;
  /** "Custom…" injection: opens the small inject dialog at a screen point. */
  openInject(nodeId: string, at: XY | undefined): void;
  /** "Start a storm here…". */
  startStorm(nodeId: string): void;
  showEvents(nodeId: string | null): void;
  /** "Highlight this path": dims everything that isn't downstream of an edge. */
  trace(edgeId: string | null): void;
  tracing(): string | null;
  /** Message trace: follow the next message at a node (or anywhere), the slowest, or a dead letter. */
  traceNext(nodeId?: string): void;
  traceSlowest(): void;
  traceDeadLettered(): void;
  /** Slow motion: the next message from a node (or anywhere), or the message traced now. */
  slowMotion(nodeId?: string): void;
  slowMotionTrace(): void;
  /** A traced message whose journey can be replayed (the palette's "Slow motion: replay this trace"). */
  canReplayTrace(): boolean;
  endTrace(): void;
  tracingMessage(): boolean;
  /** Writes a node's live tweaks into the diagram (undoable). */
  saveTweaks(nodeId: string): void;
  messageType(nodeId: string): string;
  /** "Record video…". */
  openRecord(): void;
}

const FAILURE_RATES = [0, 0.1, 0.25, 0.5, 1];
const SLOWDOWNS = [1, 2, 5, 10];
const CONCURRENCY = [1, 2, 4, 8, 16, 64];

export const EXIT_SLOW_MOTION_HINT = "Exit slow motion (Esc) first";

/** Shared registry availability for every surface that can change the live engine. */
export function liveMutationGuard(active: () => boolean) {
  return {
    enabled: () => !active(),
    hint: () => (active() ? EXIT_SLOW_MOTION_HINT : undefined),
  };
}

export function liveActions(host: LiveActionsHost): Action[] {
  const c = host.controller;
  const guard = liveMutationGuard(host.slowMotionActive);
  const protect = (rows: MenuNode[]): MenuNode[] =>
    rows.map((row) =>
      row.type !== "item" || row.id === "sim.events"
        ? row
        : {
            ...row,
            disabled: !guard.enabled(),
            hint: guard.hint(),
            run: row.run
              ? () => {
                  if (guard.enabled()) row.run?.();
                }
              : undefined,
            children: row.children && protect(row.children),
          },
    );
  const status = (id: string): NodeStatus => c.snapshot().nodes[id]?.status ?? "up";
  const role = (id: string) => c.snapshot().nodes[id]?.role ?? "none";
  const props = (id: string) => {
    const node = c.currentDiagram.nodes.find((n) => n.id === id);
    return resolveProps(role(id), node?.label ?? id, c.effectiveProps(id), node?.stencil);
  };
  const baseProps = (id: string) => {
    const node = c.currentDiagram.nodes.find((n) => n.id === id);
    const raw = { ...node?.props, ...c.getState().simulation?.setup?.props?.[id] };
    return resolveProps(role(id), node?.label ?? id, raw, node?.stencil);
  };
  const baseLatency = (id: string) => baseProps(id).latencyMs || 250;
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
        return protect(rows);
      },
    },
    {
      id: "sim.trace-next",
      section: "simulation",
      targets: ["node"],
      label: "Trace next message from here",
      icon: "trace",
      order: 15,
      when: (ctx) => isNode(ctx.nodeId),
      run: (ctx) => host.traceNext(ctx.nodeId!),
    },
    {
      id: "sim.slowmo-from",
      section: "simulation",
      targets: ["node"],
      label: "Watch one message in slow motion from here",
      icon: "slowmo",
      order: 16,
      when: (ctx) => isNode(ctx.nodeId),
      run: (ctx) => host.slowMotion(ctx.nodeId!),
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
      order: 50,
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
        // A network device's pair or cluster: lose a unit (an active-standby pair fails over), or get them back.
        const device = p.device;
        if (device && device.ha !== "standalone" && status(id) === "up") {
          const base = baseProps(id).replicas;
          if (p.replicas > 1)
            rows.push({
              type: "item",
              id: "sim.fail-unit",
              label: device.ha === "active-standby" ? "Fail the active unit" : "Fail one unit",
              run: () => c.setNodeProps(id, { replicas: p.replicas - 1 }),
            });
          if (p.replicas < base)
            rows.push({
              type: "item",
              id: "sim.restore-units",
              label: `Bring back every unit (${base})`,
              run: () => c.setNodeProps(id, { replicas: base }),
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
        return protect(rows);
      },
    },
    {
      id: "sim.trace",
      section: "simulation",
      targets: ["edge"],
      label: (ctx) => (host.tracing() === ctx.edgeId ? "Clear highlight" : "Highlight this path"),
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
      icon: "traffic",
      order: 20,
      checked: () => c.getState().traffic,
      enabled: () => c.getState().traffic || !c.trafficHint(),
      hint: () => c.trafficHint(),
      run: () => c.setTraffic(!c.getState().traffic),
    },
    {
      // One entry for the three ways in; the palette lists them as "Trace a message › …".
      id: "sim.trace-message",
      section: "simulation",
      targets: ["canvas"],
      label: "Trace a message",
      icon: "trace",
      order: 25,
      children: () => [
        {
          type: "item",
          id: "sim.trace-message:slowmo",
          label: "Next message, in slow motion",
          keywords: "slow motion watch replay step",
          run: () => host.slowMotion(),
        },
        { type: "item", id: "sim.trace-message:next", label: "Next message", run: () => host.traceNext() },
        {
          type: "item",
          id: "sim.trace-message:slowest",
          label: "Slowest so far",
          keywords: "latency longest outage",
          run: () => host.traceSlowest(),
        },
        {
          type: "item",
          id: "sim.trace-message:dead-letter",
          label: "One that dead-lettered",
          keywords: "dlq dead letter poison failed outage",
          run: () => host.traceDeadLettered(),
        },
      ],
    },
    {
      id: "sim.slowmo-trace",
      section: "simulation",
      targets: ["canvas"],
      label: "Slow motion: replay this trace",
      icon: "slowmo",
      paletteOnly: true,
      when: () => host.canReplayTrace(),
      run: () => host.slowMotionTrace(),
    },
    {
      id: "sim.trace-end",
      section: "simulation",
      targets: ["canvas"],
      label: "End trace",
      icon: "trace",
      paletteOnly: true,
      when: () => host.tracingMessage(),
      run: () => host.endTrace(),
    },
    {
      id: "sim.clear-trace",
      section: "simulation",
      targets: ["canvas"],
      label: "Clear highlight",
      icon: "route",
      order: 30,
      when: () => host.tracing() !== null,
      run: () => host.trace(null),
    },
    {
      id: "sim.record",
      section: "simulation",
      targets: ["canvas"],
      label: "Record video…",
      icon: "record",
      order: 50,
      run: () => host.openRecord(),
    },
    {
      id: "sim.reset",
      section: "simulation",
      targets: ["canvas"],
      label: "Restart",
      icon: "reset",
      order: 40,
      run: () => c.restart(),
    },
  ];
  // Live verbs only exist in live view; the registry offers them there and nowhere else.
  const mutations = new Set(["sim.inject", "sim.storm", "sim.kill", "sim.inject-sources", "sim.traffic", "sim.reset"]);
  return actions.map((action) => ({
    ...action,
    ...(mutations.has(action.id)
      ? {
          enabled: (ctx) => guard.enabled() && (action.enabled?.(ctx) ?? true),
          hint: (ctx) => guard.hint() ?? (typeof action.hint === "function" ? action.hint(ctx) : action.hint),
          run: action.run
            ? (ctx) => {
                if (guard.enabled()) action.run?.(ctx);
              }
            : undefined,
        }
      : {}),
    modes: ["live"],
  }));
}
