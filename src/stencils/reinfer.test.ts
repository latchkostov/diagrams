import { describe, expect, it } from "vitest";
import { reinferRelations, relationChangeText, type RelationChange } from "./relations";

// A stencil change re-infers its edges' relationships (src/stencils/relations.ts). The owner's report: a .NET
// service drew a plain flow into a generic node, the node became App Configuration, and every request still went
// through it.

const stencils: Record<string, string> = {
  api: "service.dotnet",
  cfg: "azure.app-config",
  kv: "azure.key-vault",
  db: "generic.database",
  ci: "github-actions",
};
const of =
  (overrides: Record<string, string> = {}) =>
  (id: string) =>
    overrides[id] ?? stencils[id];

describe("reinferRelations", () => {
  it("turns a flow into the dependency its ends now imply", () => {
    const edges = [{ id: "e1", from: "api", to: "cfg" }];
    expect(reinferRelations(edges, of(), new Set(["cfg"]))).toEqual([{ id: "e1", from: "flow", to: "config" }]);
    // A flow with relation "flow" spelled out reads the same.
    expect(reinferRelations([{ ...edges[0], relation: "flow" }], of(), new Set(["cfg"]))).toHaveLength(1);
  });

  it("only looks at the changed nodes' edges", () => {
    const edges = [
      { id: "e1", from: "api", to: "cfg" },
      { id: "e2", from: "api", to: "kv" },
    ];
    expect(reinferRelations(edges, of(), new Set(["kv"])).map((c) => c.id)).toEqual(["e2"]);
    expect(reinferRelations(edges, of(), new Set())).toEqual([]);
  });

  it("never changes an edge someone set on purpose", () => {
    // Made a flow with "Make it a flow": stays a flow.
    expect(
      reinferRelations([{ id: "e1", from: "api", to: "cfg", relationOrigin: "explicit" }], of(), new Set(["cfg"])),
    ).toEqual([]);
    // Chosen as a dependency: stays when the store stops being one.
    expect(
      reinferRelations(
        [{ id: "e1", from: "api", to: "cfg", relation: "config", relationOrigin: "explicit" }],
        of({ cfg: "generic.service" }),
        new Set(["cfg"]),
      ),
    ).toEqual([]);
  });

  it("turns an inferred dependency back into a flow when the stencil stops implying it", () => {
    const edge = { id: "e1", from: "api", to: "cfg", relation: "config", relationOrigin: "inferred" };
    expect(reinferRelations([edge], of({ cfg: "generic.service" }), new Set(["cfg"]))).toEqual([
      { id: "e1", from: "config", to: "flow" },
    ]);
    // ...or into the dependency the new stencil implies.
    expect(reinferRelations([edge], of({ cfg: "azure.key-vault" }), new Set(["cfg"]))).toEqual([
      { id: "e1", from: "config", to: "secret" },
    ]);
  });

  it("leaves a dependency with no origin alone (a file written by hand can't say how it was set)", () => {
    const edge = { id: "e1", from: "api", to: "cfg", relation: "config" };
    expect(reinferRelations([edge], of({ cfg: "generic.service" }), new Set(["cfg"]))).toEqual([]);
  });

  it("keeps edges that already match, and follows a deploy source", () => {
    const edges = [
      { id: "e1", from: "api", to: "cfg", relation: "config", relationOrigin: "inferred" },
      { id: "e2", from: "ci", to: "api" },
    ];
    expect(reinferRelations(edges, of({ api: "service.java" }), new Set(["api"]))).toEqual([
      { id: "e2", from: "flow", to: "deploy" },
    ]);
  });
});

describe("relationChangeText", () => {
  const change = (to: RelationChange["to"], from: RelationChange["from"] = "flow"): RelationChange => ({
    id: "x",
    from,
    to,
  });
  it.each([
    [[change("config"), change("config")], "2 connections are now Config: no messages flow over them"],
    [[change("secret")], "1 connection is now Secret: no messages flow over it"],
    [[change("config"), change("secret")], "2 connections are now dependencies: no messages flow over them"],
    [[change("flow", "config")], "1 connection is a flow again: messages flow over it in Live"],
    [
      [change("flow", "config"), change("flow", "secret")],
      "2 connections are flows again: messages flow over them in Live",
    ],
    [[change("flow", "config"), change("secret")], "2 connections changed relationship to match their stencils"],
    [[], ""],
  ])("%#", (changes, text) => expect(relationChangeText(changes)).toBe(text));
});
