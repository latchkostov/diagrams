import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { DiagramFile } from "../../model/types";
import type { MessageTrace, TraceStep } from "../../sim/types";
import { stencilRole } from "../../stencils/roles";
import { traceOnce } from "../../trace/headless";
import { buildJourney } from "../../trace/journey";
import {
  PACING,
  buildScript,
  easeInOutCubic,
  frameAt,
  processDwell,
  stepStop,
  travelMs,
  waitDwell,
  type SlowScript,
} from "./script";

const load = (slug: string) => JSON.parse(readFileSync(`src/examples/${slug}.json`, "utf8")) as DiagramFile;
const kafka = load("kafka-order-pipeline");
const azure = load("azure-service-bus-integration");
const roles = (d: DiagramFile) => {
  const byId = new Map(d.nodes.map((n) => [n.id, n.stencil]));
  return (id: string) => stencilRole(byId.get(id) ?? "");
};

function kafkaOrder(): { trace: MessageTrace; script: SlowScript } {
  const trace = traceOnce(kafka, { from: "shopper" })!;
  return { trace, script: buildScript({ trace, diagram: kafka, roleOf: roles(kafka) }) };
}

/** Samples the whole script every `step` ms. */
function sample(script: SlowScript, step = 40, diagram: DiagramFile = kafka) {
  const out = [];
  for (let t = 0; t <= script.duration; t += step) out.push(frameAt(script, t, diagram));
  return out;
}

describe("pacing", () => {
  it("travel takes 0.9–1.8 s at about 260 px/s", () => {
    expect(travelMs(0)).toBe(900);
    expect(travelMs(260)).toBe(1000);
    expect(travelMs(390)).toBe(1500);
    expect(travelMs(5000)).toBe(1800);
    expect(travelMs(Number.NaN)).toBe(900);
  });

  it("processing dwell grows with the log of the real time, 0.6–1.6 s", () => {
    expect(processDwell(0)).toBe(600);
    expect(processDwell(40)).toBeCloseTo(853, 0);
    expect(processDwell(70)).toBeCloseTo(974, 0);
    expect(processDwell(180)).toBeCloseTo(1218, 0);
    expect(processDwell(1000)).toBe(1600);
    expect(processDwell(60_000)).toBe(1600);
    // A slower step always pauses at least as long (order is kept).
    let prev = 0;
    for (const ms of [0, 5, 20, 40, 80, 150, 300, 600, 1000, 5000]) {
      expect(processDwell(ms)).toBeGreaterThanOrEqual(prev);
      prev = processDwell(ms);
    }
  });

  it("waiting dwell is 0.5–2 s", () => {
    expect(waitDwell(0)).toBe(500);
    expect(waitDwell(100)).toBeCloseTo(800, 0);
    expect(waitDwell(4200)).toBeCloseTo(2000, 0);
    expect(waitDwell(1e9)).toBe(2000);
  });

  it("eases in and out", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(0.1)).toBeLessThan(0.1);
    expect(easeInOutCubic(0.9)).toBeGreaterThan(0.9);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });
});

describe("the Kafka order, node by node", () => {
  it("lasts about 17–25 s and never moves more than 4 dots at once", () => {
    const { script } = kafkaOrder();
    expect(script.duration).toBeGreaterThan(15_000);
    expect(script.duration).toBeLessThan(26_000);
    const frames = sample(script);
    expect(Math.max(...frames.map((f) => f.moving))).toBeLessThanOrEqual(4);
    expect(Math.max(...frames.map((f) => f.moving))).toBeGreaterThanOrEqual(3);
  });

  it("captions name the node, the edge's words and the real time; writes and appends read as such", () => {
    const { script } = kafkaOrder();
    const captions = script.beats.map((b) => b.caption ?? "");
    expect(captions[0]).toBe("Storefront sends OrderRequest");
    expect(captions).toContainEqual(expect.stringMatching(/^Commerce gateway · route POST \/orders · \d+ ms$/));
    expect(captions).toContainEqual(
      expect.stringMatching(/^Payments service · Authorize payment · \d+ ms → PaymentCompleted$/),
    );
    expect(captions).toContainEqual(expect.stringMatching(/^Order service · POST \/orders · \d+ ms → OrderPlaced$/));
    expect(captions).toContainEqual(expect.stringMatching(/^Orders database · write OrderPlaced · \d+ ms$/));
    expect(captions).toContainEqual(expect.stringMatching(/^Orders database · write OrderUpdated · \d+ ms$/));
    expect(captions).toContain("appended to orders.created.v1");
    expect(captions).toContain("appended to payments.completed.v1");
    expect(script.beats.filter((b) => b.kind === "write").length).toBeGreaterThanOrEqual(4);
    expect(script.summary).toMatch(/^Done · 2\.\d\d s · 5 copies · 5 writes$/);
    expect(script.beats.at(-1)!.kind).toBe("end");
  });

  it("fan-out copies split together and leave on one shared duration", () => {
    const { script } = kafkaOrder();
    const splits = script.beats.filter((b) => b.kind === "split");
    expect(splits.length).toBeGreaterThanOrEqual(2);
    for (const split of splits) {
      const leaving = script.beats.filter((b) => b.kind === "travel" && b.start === split.start + split.duration);
      expect(leaving.length).toBe(split.lanes!.length);
      expect(new Set(leaving.map((b) => b.duration)).size).toBe(1);
      expect(split.duration).toBe(PACING.split);
    }
  });

  it("sync replies run alongside and never hold up the next hop", () => {
    const { script } = kafkaOrder();
    const replies = script.beats.filter((b) => b.kind === "reply");
    expect(replies.length).toBeGreaterThanOrEqual(5);
    const gateway = script.beats.find((b) => b.kind === "process" && b.node === "gateway")!;
    const reply = replies.find((b) => b.edge === "shopper-to-gateway")!;
    const onward = script.beats.find((b) => b.kind === "travel" && b.edge === "gateway-to-orders")!;
    expect(reply.start).toBe(gateway.start + gateway.duration);
    expect(onward.start).toBe(gateway.start + gateway.duration);
    expect(reply.reverse).toBe(true);
  });

  it("every hop in the trace card can be sought, in order", () => {
    const { trace, script } = kafkaOrder();
    const rows = buildJourney(trace, kafka).rows;
    const starts = rows.map((r) => script.rowStart.get(r.key));
    expect(starts.every((s) => s !== undefined)).toBe(true);
    // The root's own hops are told in order.
    const root = rows.filter((r) => !r.copy).map((r) => script.rowStart.get(r.key)!);
    expect([...root].sort((a, b) => a - b)).toEqual(root);
  });

  it("frames follow the beats: current row, real clock, visited nodes, done", () => {
    const { trace, script } = kafkaOrder();
    const first = frameAt(script, 0, kafka);
    expect(first.currentRow).toBe("0");
    expect(first.real).toBe(0);
    expect(first.captions[0].text).toBe("Storefront sends OrderRequest");
    const mid = frameAt(script, script.duration / 2, kafka);
    expect(mid.real).toBeGreaterThan(0);
    expect(mid.real).toBeLessThan(trace.endedAt! - trace.startedAt);
    const end = frameAt(script, script.duration, kafka);
    expect(end.done).toBe(true);
    expect(end.real).toBe(trace.endedAt! - trace.startedAt);
    expect(end.captions.map((c) => c.text)).toContain(script.summary);
    expect(new Set(end.visited.map((v) => v.node))).toEqual(new Set(script.nodes));
    // The real clock never runs backwards.
    let prev = -1;
    for (const f of sample(script, 100)) {
      expect(f.real).toBeGreaterThanOrEqual(prev);
      prev = f.real;
    }
  });

  it("← and → step from hop to hop", () => {
    const { script } = kafkaOrder();
    expect(script.stops[0]).toBe(0);
    const second = stepStop(script, 0, 1);
    expect(second).toBe(script.stops[1]);
    expect(stepStop(script, second + 100, -1)).toBe(0);
    expect(stepStop(script, second + 1000, -1)).toBe(second);
    expect(stepStop(script, script.duration, 1)).toBe(script.duration);
    expect(stepStop(script, 0, -1)).toBe(0);
    const travelling = frameAt(script, script.stops[3] + 1, kafka);
    expect(travelling.travelling).toBe(true);
  });

  it("travel durations follow the on-screen edge length", () => {
    const trace = traceOnce(kafka, { from: "shopper" })!;
    const short = buildScript({ trace, diagram: kafka, roleOf: roles(kafka), edgeLength: () => 100 });
    const long = buildScript({ trace, diagram: kafka, roleOf: roles(kafka), edgeLength: () => 1000 });
    const hops = (s: SlowScript) => s.beats.filter((b) => b.kind === "travel").map((b) => b.duration);
    expect(Math.max(...hops(short))).toBe(900);
    expect(Math.min(...hops(long))).toBe(1800);
    expect(long.duration).toBeGreaterThan(short.duration);
  });
});

describe("edge cases", () => {
  it("retries after the 2nd fold into one beat, then the dead letter plays in red", () => {
    const trace = traceOnce(azure, {
      simulation: azure.simulations!.find((s) => s.id === "poison"),
      deadLetter: true,
    })!;
    const script = buildScript({ trace, diagram: azure, roleOf: roles(azure) });
    const fails = script.beats.filter((b) => b.kind === "fail");
    expect(fails.length).toBe(2);
    expect(fails[0].caption).toMatch(/attempt 1 failed/);
    const folded = script.beats.filter((b) => b.kind === "collapse");
    expect(folded.length).toBe(1);
    expect(folded[0].caption).toMatch(/↺ retried 3× over \d/);
    expect(folded[0].duration).toBe(PACING.collapse);
    // The dot waits at the consumer while its retries are told, then makes the last trip back.
    expect(folded[0].anchor).toEqual({ edge: "commands-to-worker", end: 1 });
    const back = script.beats.find((b) => b.kind === "retry")!;
    expect(back.reverse).toBe(true);
    expect(back.start).toBeGreaterThanOrEqual(folded[0].start + folded[0].duration);
    const dlq = script.beats.find((b) => b.kind === "dlq")!;
    const foldedBeat = folded[0];
    const chip = (t: number) => frameAt(script, t, azure).captions.filter((c) => c.chip);
    expect(chip(foldedBeat.start - 1)).toEqual([]);
    expect(chip(foldedBeat.start + foldedBeat.duration / 2)).toEqual([
      expect.objectContaining({ text: `↻ ×${foldedBeat.retries}`, node: foldedBeat.node, tone: "warn" }),
    ]);
    expect(chip(foldedBeat.start + foldedBeat.duration)).toEqual([]);
    expect(dlq.caption).toBe("Dead-lettered after 5 attempts");
    expect(dlq.tone).toBe("danger");
    expect(script.summary).toMatch(/^Dead-lettered · /);
    // The card's dead-letter row seeks to the dead-letter hop.
    const rows = buildJourney(trace, azure).rows;
    const dl = rows.find((r) => r.kind === "deadletter")!;
    expect(script.rowStart.get(dl.key)).toBe(dlq.start);
  });

  it("a fan-out wider than 4 shows 4 copies and counts the rest", () => {
    const diagram: DiagramFile = {
      ...kafka,
      nodes: [
        { id: "src", stencil: "client.browser", label: "Source", x: 0, y: 0 },
        { id: "hub", stencil: "service.go", label: "Hub", x: 0, y: 0 },
        ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `q${n}`, stencil: "postgres", label: `Store ${n}`, x: 0, y: 0 })),
      ],
      edges: [
        { id: "e0", from: "src", to: "hub", kind: "async" },
        ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `e${n}`, from: "hub", to: `q${n}`, kind: "async" as const })),
      ],
      simulations: [],
    } as DiagramFile;
    const trace = traceOnce(diagram, { from: "src" })!;
    const script = buildScript({ trace, diagram, roleOf: roles(diagram) });
    const split = script.beats.find((b) => b.kind === "split" && b.node === "hub")!;
    expect(split.copies).toBe(6);
    expect(split.lanes!.length).toBe(4);
    expect(script.hiddenCopies).toBe(2);
    const leaving = script.beats.filter((b) => b.kind === "travel" && b.start === split.start + split.duration);
    expect(leaving.length).toBe(4);
    expect(leaving[0].caption).toBe("×6 " + leaving[0].type);
    expect(leaving.slice(1).every((b) => b.caption === undefined)).toBe(true);
    expect(Math.max(...sample(script, 40, diagram).map((f) => f.moving))).toBeLessThanOrEqual(4);
  });

  it("an unfinished journey ends on where it's still waiting", () => {
    const full = traceOnce(kafka, { from: "shopper" })!;
    const cut: MessageTrace = {
      ...full,
      done: false,
      endedAt: undefined,
      steps: full.steps.filter((s) => s.t <= 1200),
    };
    const script = buildScript({
      trace: cut,
      diagram: kafka,
      roleOf: roles(kafka),
      waiting: { lag: (id) => (id === "payments" ? 1240 : undefined) },
    });
    expect(script.unfinished).toBe(true);
    expect(script.summary).toMatch(/^Still waiting at /);
    const lagged = buildScript({
      trace: { ...cut, steps: cut.steps.filter((s) => !(s.id !== 4 && s.t >= 1180)) },
      diagram: kafka,
      roleOf: roles(kafka),
      waiting: { lag: () => 1240 },
    });
    expect(lagged.summary).toMatch(/· lag 1,240$/);
  });

  it("a trace joined in flight starts where it was first seen", () => {
    const full = traceOnce(kafka, { from: "shopper" })!;
    const steps: TraceStep[] = full.steps.filter((s) => s.t >= 450);
    const script = buildScript({
      trace: { ...full, partial: true, origin: "orders", startedAt: 450, steps },
      diagram: kafka,
      roleOf: roles(kafka),
    });
    expect(script.beats[0].kind).toBe("establish");
    expect(script.beats[0].caption).toMatch(/joined in flight/);
    expect(script.beats.some((b) => b.kind === "write")).toBe(true);
  });

  it("reduced motion: still states held 1.5 s, cross-fading, no replies", () => {
    const trace = traceOnce(kafka, { from: "shopper" })!;
    const script = buildScript({ trace, diagram: kafka, roleOf: roles(kafka), reduced: true });
    expect(script.beats.some((b) => b.kind === "reply")).toBe(false);
    for (const b of script.beats) if (b.duration > 0) expect(b.duration).toBe(PACING.reducedHold);
    const hop = script.beats.find((b) => b.kind === "travel")!;
    const fading = frameAt(script, hop.start + 100, kafka);
    const dots = fading.dots.filter((d) => d.edge === hop.edge);
    expect(dots.length).toBe(2);
    expect(dots.map((d) => d.progress).sort()).toEqual([0, 1]);
    const held = frameAt(script, hop.start + 800, kafka).dots.filter((d) => d.edge === hop.edge);
    expect(held).toEqual([expect.objectContaining({ progress: 1, alpha: 1 })]);
    expect(frameAt(script, hop.start + 800, kafka).landings).toEqual([]);
  });

  it("an empty trace still has an end beat", () => {
    const script = buildScript({
      trace: {
        rootId: 1,
        type: "X",
        origin: "shopper",
        startedAt: 0,
        endedAt: 0,
        done: true,
        partial: false,
        truncated: false,
        steps: [],
      },
      diagram: kafka,
      roleOf: roles(kafka),
    });
    expect(script.beats.map((b) => b.kind)).toEqual(["end"]);
    expect(frameAt(script, 0, kafka).captions[0].text).toMatch(/^Done/);
  });
});
