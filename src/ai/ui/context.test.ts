import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import type { LiveState } from "../../live/controller";
import { aiPlace, emptyHeading, liveText, resolveScope, scopeText, suggestions } from "./context";
import { buildExplainPrompt, buildFixPrompt, buildPrompt, buildSimulationPrompt } from "./prompt";
import { parseReply } from "./reply";
import { planTurn } from "./apply";

const diagram = (): DiagramFile => ({
  format: "diagrams/v1",
  title: "Shop",
  nodes: [
    { id: "shopper", stencil: "client.user", label: "Shopper", x: 0, y: 0 },
    { id: "api", stencil: "service.dotnet", label: "orders-api", x: 200, y: 0 },
    { id: "db", stencil: "postgres", label: "orders-db", x: 400, y: 0 },
  ],
  edges: [
    { id: "e1", from: "shopper", to: "api", kind: "sync" },
    { id: "e2", from: "api", to: "db", kind: "sync", label: "write" },
  ],
  groups: [{ id: "g1", label: "Azure", x: 0, y: 0, width: 10, height: 10 }],
});

describe("context", () => {
  it("knows where it is: an empty diagram, the editor or live view", () => {
    expect(aiPlace({ ...diagram(), nodes: [], edges: [], groups: [] }, false)).toBe("create");
    expect(aiPlace(null, false)).toBe("create");
    expect(aiPlace(diagram(), false)).toBe("edit");
    expect(aiPlace(diagram(), true)).toBe("live");
    expect(emptyHeading("create", false).title).toBe("Build with AI");
    expect(emptyHeading("live", false).title).toBe("Simulate a scenario");
    expect(emptyHeading("edit", true).title).toBe("Change the selection");
  });

  it("suggests short, fitting requests, with an explain chip outside an empty diagram", () => {
    for (const [place, scoped] of [
      ["create", false],
      ["edit", false],
      ["edit", true],
      ["live", false],
    ] as const) {
      const chips = suggestions(place, scoped);
      expect(chips.length).toBeGreaterThanOrEqual(3);
      expect(chips.every((c) => c.label.length <= 28 && c.request.length > 0)).toBe(true);
      expect(chips.some((c) => c.intent === "explain")).toBe(place !== "create");
    }
  });

  it("names a selection's nodes, connections and boundaries as the request's targets", () => {
    const scope = resolveScope(diagram(), ["api", "e2", "g1", "gone"]);
    expect(scope).toEqual([
      { id: "api", label: "orders-api", kind: "node" },
      { id: "e2", label: "write", kind: "connection" },
      { id: "g1", label: "Azure", kind: "boundary" },
    ]);
    const text = scopeText(scope);
    expect(text).toContain("selected elements");
    expect(text).toContain('node "api" "orders-api"');
    expect(scopeText([])).toBe("");
    const prompt = buildPrompt({ request: "Scale it", describe: "nodes…", context: text });
    expect(prompt.indexOf('node "api" "orders-api"')).toBeLessThan(prompt.indexOf("My request:"));
    expect(prompt.indexOf('node "api" "orders-api"')).toBeGreaterThan(prompt.indexOf("Current diagram:"));
  });

  it("describes what's running in live view", () => {
    const node = (id: string, extra: object) => ({
      id,
      role: "processor",
      status: "up",
      backlog: 0,
      lag: {},
      inFlight: 0,
      processed: 0,
      failed: 0,
      deadLettered: 0,
      dropped: 0,
      throughput: 0,
      units: "real",
      ...extra,
    });
    const state = {
      playing: true,
      simulation: { id: "s", title: "Storm", traffic: [] },
      run: {
        time: 42_000,
        totalMs: 120_000,
        expectations: [{ id: "x", label: "No backlog", status: "fail", value: 3 }],
      },
      snapshot: {
        time: 42_000,
        inSystem: 130,
        nodes: {
          api: node("api", { backlog: 120, inFlight: 8, throughput: 35.4, failed: 2 }),
          db: node("db", { status: "down" }),
          shopper: node("shopper", {}),
        },
      },
    } as unknown as LiveState;
    const text = liveText(state, diagram());
    expect(text).toContain('simulation "Storm" at 0:42 of 2:00');
    expect(text).toContain("130 messages in flight");
    expect(text).toContain('"api" "orders-api": backlog 120, in process 8, 35/s, 2 failed');
    expect(text).toContain('"db" "orders-db": down');
    expect(text).not.toContain("shopper");
    expect(text).toContain('Failing expectations: "No backlog"');
  });
});

describe("prompts for live view and explain", () => {
  it("asks for one simulation in the set_simulation format", () => {
    const p = buildSimulationPrompt({ request: "A storm at 9am", describe: "nodes: shopper" });
    expect(p).toContain("one simulation");
    expect(p).toContain('"traffic"');
    expect(p).toContain("A storm at 9am");
    expect(p).not.toContain('"add_node"');
  });

  it("explains without asking for anything to paste back, with live numbers when given", () => {
    const p = buildExplainPrompt({ request: "", describe: "nodes: shopper", context: "Live view, playing" });
    expect(p).toContain("Explain this architecture diagram");
    expect(p).toContain("Live view, playing");
    expect(p).not.toContain("JSON");
  });

  it("asks for a corrected simulation after a failed one", () => {
    const p = buildFixPrompt({
      request: "storm",
      describe: "d",
      reply: "{}",
      error: { error: "Unknown reference" },
      simulation: true,
    });
    expect(p).toContain("Your simulation for my Diagrams diagram failed");
    expect(p).toContain("complete simulation as one JSON object");
  });
});

describe("simulation replies", () => {
  const spec = {
    title: "Storm",
    durationSec: 60,
    traffic: [{ from: "shopper", pattern: "burst", count: 100 }],
    events: [{ atSec: 20, node: "api", do: "down" }],
  };

  it("parses a simulation, bare or wrapped, fenced or not", () => {
    for (const text of [
      "```json\n" + JSON.stringify(spec) + "\n```",
      JSON.stringify({ simulation: spec }),
      JSON.stringify({ name: "set_simulation", arguments: spec }),
      `Here you go: ${JSON.stringify(spec)}`,
    ]) {
      const r = parseReply(text);
      expect(r.ok && r.kind).toBe("simulation");
    }
    const bad = parseReply(JSON.stringify({ title: "x", traffic: [{ from: "a", pattern: "nope" }] }));
    expect(bad.ok).toBe(false);
  });

  it("plans one undo step that adds the simulation, or replaces the one it names", () => {
    const plan = planTurn(diagram(), parseReply(JSON.stringify(spec)));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.summary).toBe("Added simulation “Storm”");
    expect(plan.next.simulations).toHaveLength(1);
    expect(plan.simulationId).toBe(plan.next.simulations![0].id);
    expect(plan.next.nodes).toEqual(diagram().nodes);
    expect(plan.changed).toEqual(["shopper"]);

    const again = planTurn(plan.next, parseReply(JSON.stringify({ ...spec, replace: "Storm", title: "Storm 2" })));
    expect(again.ok && again.summary).toBe("Updated simulation “Storm 2”");
    expect(again.ok && again.next.simulations).toHaveLength(1);
  });

  it("an unknown node fails with candidates, applying nothing", () => {
    const plan = planTurn(
      diagram(),
      parseReply(JSON.stringify({ title: "x", traffic: [{ from: "orders", pattern: "burst", count: 5 }] })),
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error.error).toContain("orders");
  });
});
