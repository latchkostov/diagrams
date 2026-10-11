import { describe, expect, it } from "vitest";
import type { DiagramEdge, DiagramFile, DiagramNode, EdgeRelation } from "../model/types";
import { compileTopology } from "./topology";
import { createEngine } from "./engine";
import { analyzeCapacity } from "./capacity";
import { traceOnce } from "../trace/headless";
import { buildJourney } from "../trace/journey";
import aksJson from "../examples/aks-app-config-key-vault.json";
import azureJson from "../examples/azure-service-bus-integration.json";

// Dependencies (config, secret, identity, telemetry, deploy, depends) carry no traffic: the topology,
// the engine, capacity analysis and the tracer never see them (docs/SIMULATION.md "Dependencies").

const node = (id: string, stencil: string, props: Record<string, unknown> = {}): DiagramNode => ({
  id,
  stencil,
  label: id,
  x: 0,
  y: 0,
  props: { jitter: 0, ...props },
});
const edge = (from: string, to: string, relation?: EdgeRelation, kind: "async" | "sync" = "sync"): DiagramEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  kind,
  ...(relation ? { relation } : {}),
  props: { travelMs: 20 },
});

/** client → api → db, plus every dependency from the api (and a config store referencing the vault). */
function withDependencies(): DiagramFile {
  return {
    format: "diagrams/v1",
    title: "Dependencies",
    nodes: [
      node("client", "client.browser", { ratePerSec: 10 }),
      node("api", "service.dotnet", { latencyMs: 20 }),
      node("db", "postgres"),
      node("cfg", "azure.app-config"),
      node("kv", "azure.key-vault"),
      node("mi", "azure.managed-identity"),
      node("logs", "azure.app-insights"),
      node("ci", "github-actions"),
      node("dns", "generic.dns"),
    ],
    edges: [
      edge("client", "api"),
      edge("api", "db"),
      edge("api", "cfg", "config"),
      edge("cfg", "kv", "secret"),
      edge("api", "kv", "secret"),
      edge("api", "mi", "identity"),
      edge("api", "logs", "telemetry", "async"),
      edge("ci", "api", "deploy"),
      edge("api", "dns", "depends"),
    ],
  };
}

const DEPENDENCY_IDS = ["api-cfg", "cfg-kv", "api-kv", "api-mi", "api-logs", "ci-api", "api-dns"];

describe("simulation ignores dependencies", () => {
  it("the compiled topology has only the flows", () => {
    const t = compileTopology(withDependencies());
    expect(t.edges.map((e) => e.id)).toEqual(["client-api", "api-db"]);
    expect(t.outgoing.get("api")?.map((e) => e.id)).toEqual(["api-db"]);
    expect(t.outgoing.has("ci")).toBe(false);
  });

  it("an explicit flow relation is still a flow", () => {
    const d = withDependencies();
    d.edges[1] = { ...d.edges[1], relation: "flow" };
    expect(compileTopology(d).edges.map((e) => e.id)).toEqual(["client-api", "api-db"]);
  });

  it("no particle ever travels a dependency, and every message still reaches the database", () => {
    const engine = createEngine({ seed: 1 });
    engine.load(withDependencies());
    engine.inject("client", 20, { spreadMs: 500 });
    const seen = new Set<string>();
    for (let t = 0; t < 8000; t += 10) {
      engine.step(10);
      for (const p of engine.frame().particles) seen.add(p.edgeId);
    }
    for (const id of DEPENDENCY_IDS) expect(seen.has(id), id).toBe(false);
    expect(seen.has("client-api")).toBe(true);
    const snap = engine.snapshot();
    expect(snap.nodes.db.processed).toBe(20);
    for (const id of ["cfg", "kv", "mi", "logs", "dns"]) expect(snap.nodes[id].processed, id).toBe(0);
    for (const id of DEPENDENCY_IDS) expect(snap.edges[id], id).toBeUndefined();
    expect(snap.inSystem).toBe(0);
  });

  it("the same diagram without the dependency edges behaves identically (same seed)", () => {
    const run = (d: DiagramFile) => {
      const engine = createEngine({ seed: 9 });
      engine.load(d);
      engine.inject("client", 15, { spreadMs: 300 });
      for (let t = 0; t < 4000; t += 10) engine.step(10);
      return JSON.stringify(engine.snapshot().nodes);
    };
    const d = withDependencies();
    expect(run(d)).toBe(run({ ...d, edges: d.edges.filter((e) => !e.relation) }));
  });

  it("capacity analysis offers no demand to dependency targets", () => {
    const a = analyzeCapacity(withDependencies());
    expect(a.nodes.db.offered).toBeCloseTo(10);
    for (const id of ["cfg", "kv", "mi", "logs", "dns"]) expect(a.nodes[id]?.offered ?? 0, id).toBe(0);
    expect(a.bottleneck?.id).not.toBe("kv");
  });

  it("a traced message's journey never visits a dependency", () => {
    const trace = traceOnce(withDependencies(), { from: "client" });
    expect(trace).toBeDefined();
    const journey = buildJourney(trace!, withDependencies());
    expect(journey.visits.map((v) => v.node)).not.toContain("kv");
    expect(new Set(journey.visits.map((v) => v.node))).toEqual(new Set(["client", "api", "db"]));
  });
});

describe("examples with dependencies", () => {
  it("Azure invoice intake reads its secret and sends telemetry without traffic", () => {
    const d = azureJson as DiagramFile;
    const vault = d.edges.find((e) => e.id === "ingest-to-vault");
    expect(vault?.relation).toBe("secret");
    expect(d.edges.find((e) => e.id === "ingest-to-insights")?.relation).toBe("telemetry");
    const t = compileTopology(d);
    expect(t.edges.some((e) => e.to === "vault" || e.to === "insights")).toBe(false);
  });

  it("the AKS example routes requests and events only", () => {
    const d = aksJson as DiagramFile;
    const t = compileTopology(d);
    expect(t.edges.map((e) => e.id).sort()).toEqual(
      ["api-to-sb", "api-to-sql", "fd-to-api", "sb-to-notify", "web-to-fd"].sort(),
    );
  });
});
