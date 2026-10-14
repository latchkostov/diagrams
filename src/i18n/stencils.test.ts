import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { catalogs } from "virtual:i18n/catalogs";
import { catalog } from "../stencils/catalog";
import { FALLBACK_STENCIL } from "../stencils/registry";
import { searchStencils } from "../lib/stencilDisplaySearch";
import { quickAddMenu, stencilMenu } from "../editor/builtinActions";
import { findStencils, resolveKind } from "../ai/stencils";
import { STENCIL_ALIASES } from "../lib/stencilSearch";
import { searchStencils as englishSearch } from "../lib/stencilSearch";
import { state, type Catalog } from "./core";
import en from "./en";
import { sourceHash } from "./validate";
import { categoryLabel } from "./chrome";
import { stencilLabel, stencilDescription, stencilSubtitle, vendorLabel } from "./stencils";

afterEach(() => {
  state.l = "en";
  state.c = undefined;
});

describe("stencil display text", () => {
  it("preserves every English name, description, subtitle and vendor byte for byte", () => {
    for (const s of [...catalog, FALLBACK_STENCIL]) {
      expect(stencilLabel(s), s.id).toBe(s.label);
      expect(stencilDescription(s), s.id).toBe(s.description);
      expect(stencilSubtitle(s), s.id).toBe(s.defaultSublabel);
      expect(vendorLabel(s.vendor), s.id).toBe(s.vendor);
    }
  });

  it("preserves English discovery results, including family counts for abbreviated product names", () => {
    const queries = catalog.flatMap((s) => [s.label, s.id, ...(STENCIL_ALIASES[s.id] ?? [])]);
    for (const query of queries) expect(searchStencils(catalog, query), query).toEqual(englishSearch(catalog, query));
    expect(searchStencils(catalog, "sqs").map((s) => s.id)).toEqual(["aws.sqs"]);
  });

  it.each(Object.keys(catalogs).filter((code) => code !== "en-XA"))(
    "%s translates every extracted message with a current source stamp",
    (code) => {
      const read = (file: string) =>
        JSON.parse(fs.readFileSync(path.resolve("src/i18n/locales", file), "utf8")) as Record<string, string>;
      const messages = read(`${code}.json`);
      const meta = JSON.parse(fs.readFileSync(path.resolve("src/i18n/locales", `${code}.meta.json`), "utf8")) as {
        sources: Record<string, string>;
      };
      for (const [key, english] of Object.entries(en).filter(([key]) => key.startsWith("stencil."))) {
        expect(messages[key], key).toBeTruthy();
        expect(meta.sources[key], key).toBe(sourceHash(english));
      }
    },
  );

  it.each(["de", "ja", "ar", "en-XA"])("%s localizes discovery without mutating agent/file records", async (code) => {
    const before = JSON.stringify(catalog);
    const database = catalog.find((s) => s.id === "generic.database")!;
    const kafka = catalog.find((s) => s.id === "kafka.topic")!;
    const menuBeforeSwitch = stencilMenu("change", () => ({}));
    const recentBeforeSwitch = quickAddMenu(() => {}, [database.id]);
    // Pin every English agent name/alias result, including ranking, then repeat with a UI locale loaded.
    const queries = [...new Set(catalog.flatMap((s) => [s.label, s.id, ...(STENCIL_ALIASES[s.id] ?? [])]))];
    const agents = queries.map((query) => findStencils(query));
    const resolved = queries.map((query) => resolveKind(query));
    // Populate the same object's English search cache, then switch language.
    searchStencils(catalog, "database");
    state.l = code;
    state.c = (await catalogs[code]()).default as Catalog;
    expect(stencilLabel(database)).not.toBe(database.label);
    expect(stencilDescription(database)).not.toBe(database.description);
    expect(stencilSubtitle(database)).not.toBe(database.defaultSublabel);
    if (code !== "en-XA") expect(stencilLabel(kafka)).toContain("Kafka");
    for (const id of ["stripe", "iterable", "aws.lambda", "cisco.isr", "f5.bigip"]) {
      const s = catalog.find((s) => s.id === id)!;
      expect(stencilLabel(s), id).toBe(s.label);
    }
    expect(searchStencils(catalog, stencilLabel(database))[0]).toBe(database);
    expect(searchStencils(catalog, "database")[0]).toBe(database);
    expect(searchStencils(catalog, "pg")[0].id).toBe("postgres");
    expect(searchStencils(catalog, stencilDescription(database))).toContain(database);
    expect(queries.map((query) => findStencils(query))).toEqual(agents);
    expect(queries.map((query) => resolveKind(query))).toEqual(resolved);
    expect(resolveKind("IoT devices").id).toBe("client.iot");
    const generic = menuBeforeSwitch.find((n) => n.type === "item" && n.id === "change:cat:generic");
    expect(generic?.type === "item" && generic.label).toBe(categoryLabel.generic);
    expect(
      generic?.type === "item" && generic.children?.find((n) => n.type === "item" && n.stencil === database.id),
    ).toMatchObject({ label: stencilLabel(database) });
    expect(recentBeforeSwitch).toContainEqual(expect.objectContaining({ label: stencilLabel(database) }));
    expect(JSON.stringify(catalog)).toBe(before);
    state.l = "en";
    state.c = undefined;
    expect(searchStencils(catalog, "database")[0]).toBe(database);
  });
});
