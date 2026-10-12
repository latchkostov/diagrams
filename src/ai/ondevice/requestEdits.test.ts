import { describe, expect, it } from "vitest";
import { editIntents, fillEdits } from "./requestEdits";

describe("what an edit request says about renames and kind changes", () => {
  it("reads rename and kind-change patterns, each target in its own clause", () => {
    expect(editIntents("Rename Payments service to Billing service")).toEqual([
      { target: "Payments service", field: "label", value: "Billing service" },
    ]);
    expect(editIntents("Rename the Payments service to Billing, and make Orders database a MongoDB.")).toEqual([
      { target: "Payments service", field: "label", value: "Billing" },
      { target: "Orders database", field: "kind", value: "MongoDB" },
    ]);
    expect(editIntents("Change the Orders database to Cosmos DB, then Payments should be a Go service.")).toEqual([
      { target: "Orders database", field: "kind", value: "Cosmos DB" },
      { target: "Payments", field: "kind", value: "Go service" },
    ]);
    expect(editIntents("Turn the cache into a Redis cache")).toEqual([
      { target: "cache", field: "kind", value: "Redis cache" },
    ]);
  });

  it("a kind must name a technology; requests that aren't edits say nothing", () => {
    expect(editIntents("Change Orders database to the old one")).toEqual([]);
    expect(editIntents("A browser calls a Node.js API")).toEqual([]);
    expect(editIntents("Add a dead-letter queue after Inventory service")).toEqual([]);
  });

  it("fills a missing field for the same element only, and drops an empty or repeated change", () => {
    const ids: Record<string, string> = { "orders database": "db", "payments service": "pay" };
    const element = (n: string) => ids[n.toLowerCase()];
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
});
