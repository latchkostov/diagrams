import { expect, it } from "vitest";
import type { BadgeProps } from "./NodeBadges";
import type { NodeSimState } from "../sim/types";
import { sameBadge } from "./badgeMemo";
import { HealthWindow } from "./healthWindow";

const sample: NodeSimState = {
  id: "api",
  role: "processor",
  status: "up",
  processed: 0,
  backlog: 0,
  throughput: 0,
  inFlight: 0,
  failed: 0,
  dropped: 0,
  deadLettered: 0,
  lag: {},
};
const badge = { s: sample, node: {}, hovered: false, fault: "", showOutageLoss: false } as BadgeProps;

it("skips unchanged displayed values even when snapshot-only metrics and processor metrics change", () => {
  expect(
    sameBadge(badge, {
      ...badge,

      s: { ...sample, lag: { group: 10 }, activeReplicas: 3, rejectionReasons: { quota: 3 } },
    }),
  ).toBe(true);
  const broker = { ...badge, s: { ...sample, role: "topic" as const } };
  expect(sameBadge(broker, { ...broker, s: { ...broker.s } })).toBe(false);
});

it.each(
  Object.entries({
    role: "sink",
    status: "down",
    processed: 1,
    backlog: 1,
    inFlight: 1,
    failed: 1,
    dropped: 1,
    deadLettered: 1,
    blocked: 1,
    shed: 1,
    queueDepth: 1,
    queueLimit: 1,
    failingOver: true,
    throughput: 1,
    idleReplicas: 1,
    replicas: 1,
    noConsumer: true,
  }),
)("tracks the visibility of %s", (key, value) => {
  const hidden = import.meta.env.VITE_E2E !== "1" && ["failed", "dropped", "deadLettered"].includes(key);
  expect(sameBadge(badge, { ...badge, s: { ...sample, [key]: value } })).toBe(hidden);
});

it("refreshes hover details and node placement even when numbers stay equal", () => {
  expect(sameBadge(badge, { ...badge, hovered: true })).toBe(false);
  expect(sameBadge({ ...badge, hovered: true }, badge)).toBe(false);
  expect(sameBadge(badge, { ...badge, node: { ...badge.node } })).toBe(false);
  expect(sameBadge(badge, { ...badge, fault: "Fault" })).toBe(false);
});

it("compares the displayed thread and fleet numbers rather than histories", () => {
  const s = {
    ...sample,
    threads: { slots: 4, working: 1, waiting: 2, inFlight: 1, queued: 0, waitingOn: [] },
    fleet: { ready: 3, starting: 0, desired: 3, draining: 0, history: [] },
  };
  const a = { ...badge, s };
  expect(
    sameBadge(a, {
      ...a,
      s: {
        ...s,
        threads: { ...s.threads, waitingOn: [["db", 1]] },
        fleet: { ...s.fleet, history: [{ time: 0, ready: 0, starting: 0, desired: 3, draining: 0 }] },
      },
    }),
  ).toBe(true);
  for (const key of ["slots", "working", "waiting", "inFlight"] as const)
    expect(sameBadge(a, { ...a, s: { ...s, threads: { ...s.threads, [key]: 9 } } })).toBe(false);
  for (const key of ["ready", "starting", "desired", "draining"] as const)
    expect(sameBadge(a, { ...a, s: { ...s, fleet: { ...s.fleet, [key]: 9 } } })).toBe(false);
});

it("refreshes recent health even with unchanged cumulative counts", () => {
  const health = new HealthWindow();
  health.observe({ time: 0, nodes: { api: { ...sample, dropped: 0 } }, edges: {} }, 0);
  const lost = { ...sample, dropped: 3 };
  health.observe({ time: 1000, nodes: { api: lost }, edges: {} }, 0);
  expect(sameBadge({ ...badge, s: lost }, { ...badge, s: { ...lost } })).toBe(false);
});
