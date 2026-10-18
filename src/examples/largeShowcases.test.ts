import { describe, expect, it } from "vitest";
import type { DiagramFile, Simulation } from "../model/types";
import { validateDiagram } from "../interop/native";
import { createSimulationRun } from "../sim/simulation";
import type { SimSnapshot } from "../sim/types";
import { loadExample } from "./index";
import { estimateCardSize } from "../canvas/nodes/size";
import { NOTE_FIT } from "../canvas/camera/geometry";

// The large public showcases (docs/EXAMPLES.md): each tells its saved stories on a realistic, invented system.
// Public fixtures only: this shallow glob never descends into local-only examples.
const files = import.meta.glob<DiagramFile>("./*.json", { eager: true, import: "default" });
const LARGE = [
  "black-friday-commerce",
  "cell-based-bookings",
  "payments-ledger",
  "delivery-dispatch",
  "ev-charging-network",
  "recommendations-feature-store",
  "video-on-demand-pipeline",
  "observability-pipeline",
  "hybrid-enterprise-network",
] as const;
const diagram = (slug: string) => files[`./${slug}.json`];
const simulation = (slug: string, id: string): Simulation => {
  const s = diagram(slug).simulations?.find((x) => x.id === id);
  if (!s) throw new Error(`${slug} has no simulation ${id}`);
  return s;
};

/** Plays a saved simulation to its end, sampling the engine every `everyMs` of simulated time. */
function play(slug: string, id: string, everyMs = 500) {
  const run = createSimulationRun(diagram(slug), simulation(slug, id));
  const samples: { time: number; snap: SimSnapshot }[] = [];
  let next = 0;
  for (let step = 0; step < 7000 && !run.state().done; step++) {
    if (run.state().waiting) run.resume();
    run.step(10);
    if (run.state().time >= next) {
      samples.push({ time: run.state().time, snap: run.engine.snapshot() });
      next += everyMs;
    }
  }
  expect(run.state().done, id).toBe(true);
  expect(
    run.state().expectations.map((e) => e.status),
    id,
  ).toEqual(simulation(slug, id).expectations?.map(() => "pass"));
  return { end: run.engine.snapshot(), samples };
}
const between = (samples: { time: number; snap: SimSnapshot }[], from: number, to: number) =>
  samples.filter((s) => s.time >= from && s.time < to).map((s) => s.snap);
const most = (snaps: SimSnapshot[], node: string, field: "replicas" | "activeReplicas") =>
  Math.max(...snaps.map((s) => s.nodes[node]?.[field] ?? 0));

/** The zoom React Flow's fit gives these node boxes inside a pane, as Live's camera does (src/canvas/camera/geometry.ts). */
function fitZoom(
  d: DiagramFile,
  ids: readonly string[] | null,
  pane: { width: number; height: number },
  fit: typeof NOTE_FIT,
) {
  const boxes = d.nodes
    .filter((n) => !ids || ids.includes(n.id))
    .map((n) => ({ x: n.x, y: n.y, ...estimateCardSize(n.label, n.sublabel) }));
  const width = Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x));
  const height = Math.max(...boxes.map((b) => b.y + b.height)) - Math.min(...boxes.map((b) => b.y));
  const room = {
    width: pane.width - fit.insets.left - fit.insets.right,
    height: pane.height - fit.insets.top - fit.insets.bottom,
  };
  return Math.min(fit.maxZoom, room.width / width, room.height / height);
}
/** Live's canvas at 1920 × 1080, less the top bar and rails. (On a phone the canvas's 15% minimum zoom binds: see
 * docs/backlog/2026-10-18-phone-narration-zoom.md.) */
const DESKTOP = { width: 1820, height: 1000 };

describe("large showcases", () => {
  it.each(LARGE)("%s narrates in readable close-ups", (slug) => {
    const d = diagram(slug);
    for (const s of d.simulations ?? [])
      for (const step of s.timeline ?? []) {
        if (step.action.do !== "note" || !step.action.focus?.length) continue;
        const at = `${s.id}@${step.atMs}`;
        // On a desktop the focused cards' 13.5 px names render at 8 px or more.
        expect(fitZoom(d, step.action.focus, DESKTOP, NOTE_FIT), at).toBeGreaterThanOrEqual(0.6);
      }
  });

  it.each(LARGE)("%s is large, valid, laid out and replays deterministically", async (slug) => {
    const d = await loadExample(slug);
    expect(validateDiagram(d)).toMatchObject({ ok: true });
    // Large on purpose (40-150 nodes), but well under live view's adaptive threshold of about 1,000 nodes plus edges.
    expect(d.nodes.length).toBeGreaterThanOrEqual(40);
    expect(d.nodes.length + d.edges.length).toBeLessThan(400);
    // Every node sits inside the boundaries it belongs to, nested ones inside their parents.
    const groups = new Map((d.groups ?? []).map((g) => [g.id, g]));
    for (const n of d.nodes) {
      for (let g = n.group ? groups.get(n.group) : undefined; g; g = g.group ? groups.get(g.group) : undefined) {
        expect(
          n.x >= g.x && n.y >= g.y && n.x + 220 <= g.x + g.width && n.y + 72 <= g.y + g.height,
          `${n.id} in ${g.id}`,
        ).toBe(true);
      }
    }
    // Boundaries that are not nested in one another never overlap.
    const ancestors = (id: string) => {
      const out: string[] = [];
      for (let g = groups.get(id); g; g = g.group ? groups.get(g.group) : undefined) out.push(g.id);
      return out;
    };
    const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const a of d.groups ?? [])
      for (const b of d.groups ?? [])
        if (a.id < b.id && !ancestors(a.id).includes(b.id) && !ancestors(b.id).includes(a.id))
          expect(overlap(a, b), `${a.id} / ${b.id}`).toBe(false);
    // A narrated story starts within the first ten seconds of every saved simulation.
    for (const s of d.simulations ?? []) {
      const notes = (s.timeline ?? []).filter((t) => t.action.do === "note");
      expect(notes.filter((t) => t.atMs <= 10_000).length, s.id).toBeGreaterThanOrEqual(2);
      expect(
        notes.every((t) => t.action.do !== "note" || !t.action.pause),
        s.id,
      ).toBe(true);
    }
    for (const s of d.simulations ?? []) {
      const replay = () => {
        const run = createSimulationRun(d, s);
        for (let step = 0; step < 7000 && !run.state().done; step++) run.step(10);
        return run.engine.snapshot();
      };
      expect(replay()).toEqual(replay());
    }
  });

  it("Black Friday: the gateway sheds checkout, HPA adds pods and KEDA adds workers", () => {
    const { end, samples } = play("black-friday-commerce", "doors-open");
    expect(end.nodes.gateway.rejected).toBeGreaterThan(0);
    expect(Object.keys(end.nodes.gateway.routeRejections ?? {})).toEqual(["checkout"]);
    // Checkout starts with two pods and HPA has more running before the 8 s narration.
    expect(most(between(samples, 0, 2000), "checkout-api", "replicas")).toBe(2);
    expect(most(between(samples, 2000, 8500), "checkout-api", "replicas")).toBeGreaterThan(2);
    expect(
      most(
        samples.map((s) => s.snap),
        "fulfilment",
        "replicas",
      ),
    ).toBeGreaterThan(2);
    expect(end.nodes.orders.deadLettered).toBe(0);
  });

  it("Black Friday: a bad Loyalty deploy parks events without touching other consumer groups", () => {
    const { end } = play("black-friday-commerce", "poison-deploy");
    expect(end.nodes.orders.deadLettered).toBeGreaterThan(0);
    expect(end.nodes["orders-dlq"].processed).toBe(end.nodes.orders.deadLettered);
    for (const id of ["fulfilment", "status-projector", "notifier", "lake-sink"])
      expect(end.nodes[id].failed, id).toBe(0);
    expect(end.nodes.loyalty.failed).toBeGreaterThan(0);
    // Triage waits for the rollback, so nothing it replays is lost.
    expect(end.nodes.loyalty.dropped).toBe(0);
  });

  it("Black Friday: more fulfilment workers meet the warehouse partner's quota", () => {
    const { end } = play("black-friday-commerce", "partner-quota");
    expect(end.nodes.wms.rejected).toBeGreaterThan(0);
    expect(end.nodes.wms.failed).toBe(0);
  });

  it("Cells: a dark region's travellers move to the other two, and every booking replicates", () => {
    const { end, samples } = play("cell-based-bookings", "region-evacuation");
    const during = between(samples, 6000, 18000);
    const sent = (snaps: SimSnapshot[], node: string) =>
      snaps[snaps.length - 1].nodes[node].processed - snaps[0].nodes[node].processed;
    expect(sent(during, "east-router")).toBe(0);
    expect(sent(during, "west-router")).toBeGreaterThan(0);
    expect(sent(during, "eu-router")).toBeGreaterThan(0);
    // Each region's replica of a cell's table holds every booking for that cell, wherever it was made.
    for (const c of [1, 2])
      expect(new Set(["east", "west", "eu"].map((r) => end.nodes[`${r}-c${c}-db`].processed)).size, `cell ${c}`).toBe(
        1,
      );
    // Only origin writes send a confirmation: one email per booking.
    const bookings = ["east", "west", "eu"].reduce((sum, r) => sum + end.nodes[`${r}-router`].processed, 0);
    expect(end.nodes.email.processed).toBe(bookings);
  });

  it("Cells: a bad canary build fails bookings in its own cell only", () => {
    const { end } = play("cell-based-bookings", "bad-cell-deploy");
    expect(end.nodes["east-c1-api"].failed).toBeGreaterThan(0);
    for (const r of ["east", "west", "eu"])
      for (const c of [1, 2])
        if (`${r}-c${c}` !== "east-c1") expect(end.nodes[`${r}-c${c}-api`].failed, `${r}-c${c}`).toBe(0);
  });

  it("Payments: weights don't move by themselves; shifting them stops the failures", () => {
    const { end, samples } = play("payments-ledger", "psp-brownout");
    const at = (t: number) => samples.find((s) => s.time >= t)!.snap;
    const adyen = (s: SimSnapshot) => s.nodes.adyen.processed + s.nodes.adyen.failed;
    expect(at(8500).nodes.adyen.failed).toBeGreaterThan(0);
    // After the 9 s shift, Adyen gets nothing new (calls already in flight finish).
    expect(adyen(end)).toBe(adyen(at(10_000)));
    expect(end.nodes.stripe.failed).toBe(0);
    expect(end.nodes["payment-events"].deadLettered).toBe(0);
  });

  it("Payments: new-format disputes dead-letter while charges keep flowing, then replay", () => {
    const { end } = play("payments-ledger", "poison-dispute");
    expect(end.nodes["psp-q"].deadLettered).toBe(12);
    expect(end.nodes["psp-events"].failed).toBe(0);
    expect(end.nodes["psp-redrive"].processed).toBe(12);
    expect(end.nodes["psp-redrive"].rejected ?? 0).toBe(0);
  });

  it("Dispatch: KEDA stops at the partition count until the topic grows", () => {
    const { samples } = play("delivery-dispatch", "partition-ceiling");
    expect(most(between(samples, 0, 12_000), "geo-indexer", "activeReplicas")).toBe(8);
    expect(most(between(samples, 12_500, 30_000), "geo-indexer", "activeReplicas")).toBeGreaterThan(8);
  });

  it("Dispatch: the maps provider's quota rejects the rush's excess", () => {
    const { end } = play("delivery-dispatch", "dinner-rush");
    expect(end.nodes.maps.rejected).toBeGreaterThan(0);
    expect(end.nodes.maps.failed).toBe(0);
  });

  it("EV charging: the depot firewall blocks the vendor shell and fails over without loss", () => {
    const shell = play("ev-charging-network", "vendor-shell").end;
    expect(shell.nodes["depot-fw"].blocked).toBeGreaterThan(0);
    expect(shell.nodes["depot-switch"].processed).toBe(shell.nodes["depot-chargers"].processed);
    const failover = play("ev-charging-network", "firewall-failover").end;
    expect(failover.nodes["depot-fw"].dropped).toBe(0);
    expect(failover.nodes.ingress.processed).toBe(failover.nodes["depot-chargers"].processed);
    const storm = play("ev-charging-network", "reboot-storm").end;
    expect(storm.nodes.ocpp.dropped).toBe(0);
  });

  it("EV charging: driver sessions reach billing, and a dead-lettered firmware command is retried", () => {
    const d = diagram("ev-charging-network");
    const engine = createSimulationRun(d, { id: "drivers", title: "Drivers", seed: 1, traffic: [] }).engine;
    engine.inject("drivers", 10, { type: "StartSession" });
    for (let t = 0; t < 400; t++) engine.step(10);
    let s = engine.snapshot();
    expect(s.nodes["sessions-db"].processed).toBe(10);
    expect(s.nodes.billing.processed).toBe(10);
    expect(s.nodes.stripe.processed).toBe(10);
    expect(s.nodes.roaming.processed).toBe(10);
    // Every command fails until it dead-letters; the DLQ hands the firmware command back to the campaign.
    const failing = structuredClone(d);
    failing.nodes.find((n) => n.id === "commands")!.props!.failureRate = 1;
    const run = createSimulationRun(failing, { id: "wave", title: "Wave", seed: 1, traffic: [] }).engine;
    run.inject("rollout", 1, { type: "FirmwareJob" });
    for (let t = 0; t < 600; t++) run.step(10);
    s = run.snapshot();
    expect(s.nodes["cmd-q"].deadLettered).toBeGreaterThan(0);
    expect(s.nodes.firmware.processed).toBeGreaterThan(1);
  });

  it("Recommendations: HPA adds rankers for the peak, and the canary's weight goes to zero", () => {
    const peak = play("recommendations-feature-store", "friday-night");
    expect(most(between(peak.samples, 0, 2000), "ranker-v7", "replicas")).toBe(4);
    expect(most(between(peak.samples, 4000, 14_000), "ranker-v7", "replicas")).toBeGreaterThan(4);
    expect(peak.end.nodes["feature-server"].dropped).toBe(0);
    // The shadow scores its mirror but answers no one: it never writes a ranking back to the home API.
    expect(peak.end.nodes["ranker-v9"].processed).toBeGreaterThan(0);
    const canary = play("recommendations-feature-store", "canary-rollback");
    const v8 = (s: SimSnapshot) => s.nodes["ranker-v8"].processed + s.nodes["ranker-v8"].failed;
    const at = (t: number) => canary.samples.find((x) => x.time >= t)!.snap;
    expect(at(7500).nodes["ranker-v8"].failed).toBeGreaterThan(0);
    // After the 8 s weight change, v8 gets nothing new (calls already in flight finish).
    expect(v8(canary.end)).toBe(v8(at(8500)));
    expect(canary.end.nodes["ranker-v7"].failed).toBe(0);
  });

  it("Recommendations: the slow-dependency drill queues rankings at the feature server, then drains", () => {
    const { end, samples } = play("recommendations-feature-store", "slow-features");
    const backlog = (from: number, to: number) =>
      Math.max(...between(samples, from, to).map((s) => s.nodes["feature-server"].backlog));
    expect(backlog(0, 4000)).toBeLessThan(10);
    expect(backlog(6000, 14_000)).toBeGreaterThan(50);
    expect(end.nodes["feature-server"].backlog).toBe(0);
    expect(end.nodes["feature-server"].dropped).toBe(0);
  });

  it("Recommendations: KEDA wakes the batch scorer from zero, no further than the partitions", () => {
    const { samples } = play("recommendations-feature-store", "sunday-picks");
    expect(most(between(samples, 0, 1000), "batch-scorer", "replicas")).toBe(0);
    const busy = most(
      samples.map((s) => s.snap),
      "batch-scorer",
      "replicas",
    );
    expect(busy).toBeGreaterThan(4);
    expect(busy).toBeLessThanOrEqual(16);
  });

  it("Video: the premiere spike doubles the 4K encoders' p95, and the growth is waiting", () => {
    const d = diagram("video-on-demand-pipeline");
    const run = createSimulationRun(d, simulation("video-on-demand-pipeline", "premiere-uploads"));
    run.step(6000);
    const before = run.engine.frame().nodes["uhd-enc"].latency!;
    expect(before.p95).toBeLessThan(3000);
    run.step(6500);
    const during = run.engine.frame().nodes["uhd-enc"].latency!;
    expect(during.p95).toBeGreaterThanOrEqual(2 * before.p95 - 500);
    expect(during.waitMs / (during.waitMs + during.workMs + during.travelMs)).toBeGreaterThan(0.25);
    expect(run.engine.frame().nodes["uhd-enc"].replicas).toBeGreaterThan(4);
    const { end } = play("video-on-demand-pipeline", "premiere-uploads");
    expect(end.nodes["encode-dlq"].processed).toBe(0);
    expect(end.nodes.packager.processed).toBe(3 * end.nodes.workflow.processed);
  });

  it("Video: corrupt 4K sources dead-letter to triage while HD and audio carry on", () => {
    const { end } = play("video-on-demand-pipeline", "corrupt-source");
    expect(end.nodes["uhd-q"].deadLettered).toBeGreaterThan(0);
    expect(end.nodes["encode-dlq"].processed).toBe(end.nodes["uhd-q"].deadLettered);
    expect(end.nodes.triage.processed).toBe(end.nodes["uhd-q"].deadLettered);
    for (const id of ["hd-enc", "audio-enc"]) expect(end.nodes[id].failed, id).toBe(0);
    const night = play("video-on-demand-pipeline", "premiere-night").end;
    // The CDN's route table: 97% of segments to the edge cache, the rest to the origin bucket.
    const segments = night.nodes["edge-cache"].processed + night.nodes.streaming.processed;
    expect(night.nodes["edge-cache"].processed / segments).toBeGreaterThan(0.9);
    expect(night.nodes.streaming.processed).toBeGreaterThan(0);
  });

  it("Observability: Kafka absorbs a log storm; traces and metrics never fall behind", () => {
    const { end, samples } = play("observability-pipeline", "log-storm");
    const lag = (snaps: SimSnapshot[], node: string, group: string) =>
      Math.max(...snaps.map((s) => s.nodes[node].lag?.[group] ?? 0));
    const storm = between(samples, 3000, 20_000);
    expect(lag(storm, "logs", "loki")).toBeGreaterThan(20);
    expect(lag(storm, "spans", "tempo")).toBeLessThan(10);
    expect(most(storm, "gateways", "replicas")).toBeGreaterThan(3);
    expect(end.nodes.ingesters.dropped).toBe(0);
  });

  it("Observability: the Loki outage drill holds logs in Kafka and loses none", () => {
    const { end, samples } = play("observability-pipeline", "loki-outage");
    const ingested = (t: number) => samples.find((s) => s.time >= t)!.snap.nodes["loki-store"].processed;
    // Nothing reaches Loki while its write path is down; ClickHouse and the archive carry on.
    expect(ingested(13_000)).toBe(ingested(5000));
    const sink = (t: number) => samples.find((s) => s.time >= t)!.snap.nodes["ch-sink"].processed;
    expect(sink(13_000)).toBeGreaterThan(sink(5000));
    expect(end.nodes["loki-store"].processed).toBe(end.nodes["ch-sink"].processed);
    expect(end.nodes.ingesters.dropped).toBe(0);
  });

  it("Network: the fibre-cut drill moves Leicester to LTE; the firewall pair fails over; the deny rule blocks guests", () => {
    const cut = play("hybrid-enterprise-network", "leicester-fibre-cut");
    const lte = (t: number) => cut.samples.find((s) => s.time >= t)!.snap.nodes.lte.processed;
    // Before the cut the router shares both underlays; while it lasts, every new tunnel goes over LTE.
    expect(lte(4000)).toBeGreaterThan(0);
    const during = lte(14_000) - lte(4500);
    const sent = (t: number) => cut.samples.find((s) => s.time >= t)!.snap.nodes["leicester-router"].processed;
    expect(during).toBeGreaterThanOrEqual(sent(14_000) - sent(4500) - 2);
    expect(cut.end.nodes["leicester-router"].dropped).toBe(0);
    const failover = play("hybrid-enterprise-network", "dc-firewall-failover").end;
    expect(failover.nodes["dc-fw"].dropped).toBe(0);
    expect(failover.nodes.erp.dropped).toBe(0);
    const guest = play("hybrid-enterprise-network", "guest-to-erp").end;
    expect(guest.nodes["hq-fw"].blocked).toBeGreaterThan(0);
    expect(guest.nodes.breakout.processed).toBeGreaterThan(0);
  });

  it("Dispatch: the partition story differs from the dinner rush at eight seconds", () => {
    const at8 = (id: string) => play("delivery-dispatch", id).samples.find((x) => x.time >= 8000)!.snap.nodes;
    const ceiling = at8("partition-ceiling");
    const rush = at8("dinner-rush");
    expect(ceiling["geo-indexer"].activeReplicas).toBe(8);
    expect(rush["geo-indexer"].activeReplicas).toBeLessThan(8);
  });
});
