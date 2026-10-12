import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { ReferenceError, ReplyRefs, resolveRef } from "./refs";

const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "References",
  nodes: [
    { id: "a", stencil: "service.dotnet", label: "Billing Worker", sublabel: "Europe", x: 0, y: 0 },
    { id: "b", stencil: "postgres", label: "Billing DB", sublabel: "primary", x: 400, y: 0 },
    { id: "c", stencil: "service.dotnet", label: "Billing Worker", sublabel: "America", x: 0, y: 200 },
  ],
  edges: [{ id: "e", from: "a", to: "b", label: "write" }],
  groups: [{ id: "g", label: "Cloud", x: 0, y: 0, width: 600, height: 300 }],
  annotations: [{ id: "n", kind: "note", text: "Important", x: 0, y: 400, width: 200, height: 160 }],
};

describe("resolveRef", () => {
  it.each([
    ["a", "a"],
    [" BILLING  db ", "b"],
    ["BillingWorker ( EUROPE )", "a"],
    ["primary", "b"],
    ["cld", "g"],
    ["Important", "n"],
    ["write", "e"],
    ["Billing Worker (Europe) -> Billing DB", "e"],
  ])("resolves %s", (ref, id) => expect(resolveRef(diagram, ref)).toBe(id));
  it("prefers ids over keys and keys over labels", () => {
    expect(resolveRef(diagram, "a", new Map([["a", "b"]]))).toBe("a");
    expect(resolveRef(diagram, "Billing DB", new Map([["Billing DB", "c"]]))).toBe("c");
  });
  it.each(["Billing Worker", "billing", "wrk"])("rejects ambiguous %s with only public candidate fields", (ref) => {
    try {
      resolveRef(diagram, ref);
      throw new Error("Expected ambiguity");
    } catch (error) {
      expect(error).toBeInstanceOf(ReferenceError);
      const candidates = (error as ReferenceError).candidates;
      expect(candidates.length).toBeGreaterThan(1);
      expect(Object.keys(candidates[0]).sort()).toEqual(["id", "label", "stencil"]);
    }
  });
  it("returns useful candidates for unknown references without claiming a match", () => {
    try {
      resolveRef(diagram, "zzzzz");
      throw new Error("Expected an unknown reference to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ReferenceError);
      expect((error as Error).message).toContain("Unknown reference");
      expect((error as ReferenceError).candidates.map((c) => c.id)).toContain("a");
    }
  });
  it("rejects parallel edge ambiguity", () =>
    expect(() =>
      resolveRef({ ...diagram, edges: [...diagram.edges, { id: "e2", from: "a", to: "b" }] }, "a -> b"),
    ).toThrow("matches 2"));
});

describe("ReplyRefs: one precedence order for a model's references", () => {
  const refs = () => {
    const r = new ReplyRefs(diagram);
    r.add({ key: "~db2", alias: "db2", kind: "PostgreSQL", label: "Billing DB" });
    r.add({ key: "~q", kind: "SQS", label: "Inbox" });
    return r;
  };

  it("an exact id, then an existing exact label, then a key the reply set", () => {
    expect(refs().resolve("a")).toEqual({ ref: "a" });
    expect(refs().resolve("Important")).toEqual({ ref: "n" });
    expect(refs().resolve("db2")).toEqual({ ref: "~db2" });
  });

  it("an existing exact label beats an identical new label", () => {
    expect(refs().resolve("Billing DB")).toEqual({ ref: "b" });
  });

  it("ignoring case, existing and new together: both matching is an error", () => {
    expect(refs().resolve("billing db")).toMatchObject({
      error: expect.stringMatching(/existing element or a new node/),
    });
    expect(refs().resolve("INBOX")).toEqual({ ref: "~q" });
    expect(refs().resolve("billing worker")).toMatchObject({ error: expect.stringMatching(/names 2 elements/) });
  });

  it("then a new node's kind, then a shared word; otherwise the core's resolution, pinned to an id", () => {
    expect(refs().resolve("sqs")).toEqual({ ref: "~q" });
    expect(refs().resolve("the inbox queue")).toEqual({ ref: "~q" });
    expect(refs().resolve("Billing Worker (Europe) -> Billing DB")).toEqual({ ref: "e" });
    expect(refs().resolve("nothing like it")).toEqual({ ref: "nothing like it" });
  });

  it("matches a phrase of the request to exactly one node", () => {
    expect(refs().match("an SQS queue")).toBe("~q");
    expect(refs().match("Billing")).toBeNull();
    expect(refs().match("")).toBeNull();
  });
});
