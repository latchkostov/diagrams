import { patternGrowth } from "../../test/patternComplexity";
import { describe, expect, it } from "vitest";
import { GROWTH_FACTOR, LINEAR_LIMIT } from "../../test/complexity";
import { betweenIntent } from "./compactOps";
import { splitClauses, tokenize } from "./requestClauses";
import { editIntents, fillEdits } from "./requestEdits";
import { requestRelations } from "./requestRelations";

const label = (target: string, value: string, negated = false) => ({ target, field: "label", value, negated });
const kind = (target: string, value: string, negated = false) => ({ target, field: "kind", value, negated });

describe("what an edit request says about renames and kind changes", () => {
  it("reads rename and kind-change patterns, each target in its own clause", () => {
    expect(editIntents("Rename Payments service to Billing service")).toEqual([
      label("Payments service", "Billing service"),
    ]);
    expect(editIntents("Rename the Payments service to Billing, and make Orders database a MongoDB.")).toEqual([
      label("Payments service", "Billing"),
      kind("Orders database", "MongoDB"),
    ]);
    expect(editIntents("Change the Orders database to Cosmos DB, then Payments should be a Go service.")).toEqual([
      kind("Orders database", "Cosmos DB"),
      kind("Payments", "Go service"),
    ]);
    expect(editIntents("Change the Orders database to Cosmos DB and Payments should be a Go service")).toEqual([
      kind("Orders database", "Cosmos DB"),
      kind("Payments", "Go service"),
    ]);
    expect(editIntents("Turn the cache into a Redis cache")).toEqual([kind("cache", "Redis cache")]);
  });

  it("a kind must name a technology; requests that aren't edits say nothing", () => {
    expect(editIntents("Change Orders database to the old one")).toEqual([]);
    expect(editIntents("A browser calls a Node.js API")).toEqual([]);
    expect(editIntents("Add a dead-letter queue after Inventory service")).toEqual([]);
  });

  it("marks negated clauses, and keeps a positive one beside them", () => {
    expect(editIntents("Do not rename Payments service to Billing service")).toEqual([
      label("Payments service", "Billing service", true),
    ]);
    expect(editIntents("Don't rename API to Billing; make Orders database a MongoDB")).toEqual([
      label("API", "Billing", true),
      kind("Orders database", "MongoDB"),
    ]);
    expect(editIntents("Rename Orders database to Ledger, but don't make it a MongoDB")).toEqual([
      label("Orders database", "Ledger"),
      kind("it", "MongoDB", true),
    ]);
  });

  it.each([
    ['Rename Payments service to "Billing and shipping"', "Billing and shipping"],
    ['Rename Payments service to "Billing, v2"', "Billing, v2"],
    ['Rename Payments service to "Billing. Shipping"', "Billing. Shipping"],
    ["Rename Payments service to “Billing; not yet”", "Billing; not yet"],
    // Unquoted, "and" starts a new clause only before an instruction.
    ["Rename Payments service to Billing and Shipping", "Billing and Shipping"],
  ])("keeps delimiters inside a quoted label: %s", (request, value) => {
    expect(editIntents(request)).toEqual([label("Payments service", value)]);
  });

  it("a quoted label keeps a separate clause separate", () => {
    expect(editIntents('Rename Payments service to "Billing, v2" and make Orders database a MongoDB')).toEqual([
      label("Payments service", "Billing, v2"),
      kind("Orders database", "MongoDB"),
    ]);
  });
});

describe("filling the reply's edits", () => {
  const ids: Record<string, string> = { "orders database": "db", "payments service": "pay", api: "api" };
  const element = (n: string) => ids[n.toLowerCase()];

  it("fills a missing field for the same element only, and drops an empty change beside another", () => {
    const request = "Make Orders database a MongoDB";
    expect(
      fillEdits(
        [
          { op: "change_kind", target: "Orders database" },
          { op: "rename", target: "Orders database" },
        ],
        request,
        element,
      ),
    ).toEqual([{ op: "change_kind", target: "Orders database", kind: "MongoDB" }]);
    // Another element's empty rename stays, for the retry to fix.
    expect(fillEdits([{ op: "rename", target: "Payments service" }], request, element)).toEqual([
      { op: "rename", target: "Payments service" },
    ]);
    // Not edits: untouched.
    const add = { op: "add", kind: "queue", label: "q" };
    expect(fillEdits([add], request, element)).toEqual([add]);
  });

  it("never fills or turns an edit from a negated clause", () => {
    const empty = { op: "rename", target: "API" };
    expect(fillEdits([empty], "Don't rename API to Billing; make Orders database a MongoDB", element)).toEqual([empty]);
    expect(fillEdits([empty], "Do not rename API to Billing", element)).toEqual([empty]);
    // "…not a MongoDB": a rename to MongoDB isn't turned into that kind change.
    const toMongo = { op: "rename", target: "Orders database", label: "MongoDB" };
    expect(fillEdits([toMongo], "Don't make Orders database a MongoDB", element)).toEqual([toMongo]);
    // The positive one beside it still fills.
    expect(
      fillEdits(
        [{ op: "change_kind", target: "Orders database" }],
        "Don't rename API to X; make Orders database a MongoDB",
        element,
      ),
    ).toEqual([{ op: "change_kind", target: "Orders database", kind: "MongoDB" }]);
  });

  it("keeps distinct and order-dependent changes; drops only one exactly like the change just before it", () => {
    const db = (kind: string, sublabel?: string) => ({
      op: "change_kind",
      target: "Orders database",
      kind,
      ...(sublabel ? { sublabel } : {}),
    });
    // Different subtitles are different changes.
    expect(fillEdits([db("MongoDB", "Primary"), db("MongoDB", "Archive")], "x", element)).toHaveLength(2);
    expect(fillEdits([db("MongoDB"), db("MongoDB", "New")], "x", element)).toHaveLength(2);
    // MongoDB, Redis, MongoDB: the last one matters.
    expect(fillEdits([db("MongoDB"), db("Redis"), db("MongoDB")], "x", element)).toEqual([
      db("MongoDB"),
      db("Redis"),
      db("MongoDB"),
    ]);
    // Exactly the same change twice in a row does nothing the second time.
    expect(fillEdits([db("MongoDB"), db("MongoDB")], "x", element)).toEqual([db("MongoDB")]);
    // An empty change with a subtitle has an effect: it stays (the core says what's missing).
    const sub = { op: "change_kind", target: "Orders database", sublabel: "v2" };
    expect(fillEdits([db("MongoDB"), sub], "x", element)).toEqual([db("MongoDB"), sub]);
  });
});

describe("the shared clause tokenizer", () => {
  it("splits at punctuation and joining words, never inside quotes, and knows negation", () => {
    expect(tokenize('Rename ".NET api" to orders.created, then stop.').map((t) => `${t.kind}:${t.text}`)).toEqual([
      "word:Rename",
      "quoted:.NET api",
      "word:to",
      "word:orders.created",
      "punct:,",
      "word:then",
      "word:stop",
      "punct:.",
    ]);
    const clauses = splitClauses('A calls "B and C" and D never calls E', new Set(["and"]));
    expect(clauses.map((c) => [c.text, c.joiner, c.negated])).toEqual([
      ['A calls "B and C"', "", false],
      ["D never calls E", "and", true],
    ]);
    // A quote without its closing quote is just part of the word.
    expect(tokenize('Rename "API to X').map((t) => t.text)).toEqual(["Rename", '"API', "to", "X"]);
  });

  it("relations read the same as before, quotes aside", () => {
    expect(
      requestRelations("Kafka topic orders.created consumed by a .NET consumer which writes to Postgres").map((r) => [
        r.subject,
        r.object,
        r.consume,
      ]),
    ).toEqual([
      ["a .NET consumer", "Kafka topic orders.created", true],
      ["a .NET consumer", "Postgres", false],
    ]);
    // "sends" alone (round 5) and "sends X to Y".
    expect(requestRelations("An external partner sends a webhook").map((r) => [r.subject, r.object])).toEqual([
      ["An external partner", "a webhook"],
    ]);
    expect(requestRelations("The API sends events to Kafka").map((r) => [r.subject, r.object])).toEqual([
      ["The API", "Kafka"],
    ]);
    expect(requestRelations("A writes to B and reads from C").map((r) => [r.subject, r.object])).toEqual([
      ["A", "B"],
      ["A", "C"],
    ]);
    expect(requestRelations('"Ingest and route" writes to Postgres').map((r) => r.subject)).toEqual([
      '"Ingest and route"',
    ]);
  });

  it("stays linear on long adversarial input", () => {
    // Each input against one an eighth as long: a pattern that backtracks takes 64 times as long or more, linear
    // about 8. A ratio, not a budget in ms, so a busy machine doesn't fail it.
    const inputs = (n: number) => {
      const pad = " ".repeat(n);
      return [
        `rename ${pad}X`,
        `make ${pad}X`,
        `a${pad}should`,
        `between ${pad}X`,
        `change ${pad}to${pad}`,
        "“".repeat(n),
        `rename X to Y${"!".repeat(n)}z`,
        "and ".repeat(n / 4),
        `${"rename ".repeat((n * 3) / 20)}to`,
      ];
    };
    const small = inputs(2_500);
    const large = inputs(2_500 * GROWTH_FACTOR);
    for (const [i, input] of large.entries()) {
      const run = (s: string) => () => {
        editIntents(s);
        requestRelations(s);
        betweenIntent(s);
      };
      expect(patternGrowth(run(small[i]), run(input)), input.slice(0, 12)).toBeLessThan(LINEAR_LIMIT);
    }
  });
});
