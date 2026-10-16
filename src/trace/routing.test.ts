import { describe, expect, it } from "vitest";
import { createEngine } from "../sim/engine";
import { routingFixture, ROUTING_TABLE } from "../lab/routingFixture";
import { buildJourney } from "./journey";
import { buildScript } from "../live/slowmo/script";
import { stencilRole } from "../stencils/roles";
import type { DiagramFile } from "../model/types";

function traced(d: DiagramFile, route: string) {
  const e = createEngine({ seed: 2, traceHistory: 10 });
  e.load(d);
  e.tracer.request({ next: "message" });
  e.inject("app", 1, { routeId: route });
  e.step(2_000);
  return e.tracer.current()!;
}
const roleOf = (d: DiagramFile) => (id: string) => stencilRole(d.nodes.find((n) => n.id === id)!.stencil);

describe("routed traces in words", () => {
  it("the journey and slow motion name the address, the rule and the split", () => {
    const d = routingFixture();
    const trace = traced(d, "orders-post");
    const hop = buildJourney(trace, d).rows.find((r) => r.kind === "hop" && r.from === "kong")!;
    expect(hop).toMatchObject({ route: "orders-post", rule: "orders" });
    const script = buildScript({ trace, diagram: d, roleOf: roleOf(d) });
    const beat = script.beats.find((b) => b.kind === "travel" && b.caption?.startsWith("POST /orders → rule 1 → "))!;
    expect(beat.caption).toMatch(/^POST \/orders → rule 1 → Orders( canary)?( \((90|10)% split\))?$/);
    // The route's colour on every plain beat, never the type's.
    expect(script.beats.filter((b) => b.tone === "plain").every((b) => b.color === "#E69F00")).toBe(true);
  });

  it("a refusal says why: no route, rejected 404", () => {
    const table = structuredClone(ROUTING_TABLE);
    table.rules = table.rules.slice(0, 1);
    const d = routingFixture({ table });
    const trace = traced(d, "search-get");
    const row = buildJourney(trace, d).rows.find((r) => r.kind === "rejected")!;
    expect(row).toMatchObject({ route: "search-get", reason: "route-not-found" });
    const script = buildScript({ trace, diagram: d, roleOf: roleOf(d) });
    expect(script.beats.some((b) => b.caption === "GET /search → no route: rejected 404")).toBe(true);
  });
});
