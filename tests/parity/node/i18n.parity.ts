// What people read, in every language (docs/I18N.md): a fixed set of messages through the real runtime (the build's
// compiled English at each call site, each language's compiled catalog) covering plain text, plurals, selects,
// numbers and tags, and the Intl formatters, with fixed values. Dates are formatted in UTC: the machine's time
// zone isn't part of the output.
import { it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { catalogs } from "virtual:i18n/catalogs";
import { state, t, type Catalog } from "../../../src/i18n";
import { tRich } from "../../../src/i18n/rich";
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatImportList,
  formatList,
  formatNumber,
  formatPercent,
  formatRate,
} from "../../../src/i18n/format";
import en from "../../../src/i18n/en";
import { parse, type Part } from "../../../src/i18n/icu";
import { expectGolden } from "../lib/golden";
import { sha256 } from "../lib/hash";

function render(): Record<string, unknown> {
  const counts = (fn: (n: number) => string) => Object.fromEntries([0, 1, 2, 5, 21, 1000].map((n) => [n, fn(n)]));
  return {
    "file.new": t("file.new"),
    "file.saveAs": t("file.saveAs"),
    "broker.noReader": t("broker.noReader"),
    "live.sourceRateLimit": t("live.sourceRateLimit"),
    "fileToast.files": counts((count) => t("fileToast.files", { count })),
    "password.useAtLeastCountPluralOneCharacter": counts((count) =>
      t("password.useAtLeastCountPluralOneCharacter", { count }),
    ),
    "library.firstlastOfCountPluralOneDiagramOther": t("library.firstlastOfCountPluralOneDiagramOther", {
      first: 21,
      last: 40,
      count: 1234,
    }),
    "broker.assigned": t("broker.assigned", { active: 3, configured: 12 }),
    "broker.fix": t("broker.fix", { name: "orders", kind: "Partitions", count: 24 }),
    "importReport.namedCount": t("importReport.namedCount", { name: "orders-api", count: 12500 }),
    "exportToast.drawio": {
      yes: t("exportToast.drawio", { private: "yes" }),
      no: t("exportToast.drawio", { private: "no" }),
    },
    "fileToast.exportedNodesPluralOneNodeOtherNodes": t("fileToast.exportedNodesPluralOneNodeOtherNodes", {
      nodes: 1,
      edges: 17,
    }),
    "fileDialog.longLink (rich)": renderToStaticMarkup(
      createElement(
        "p",
        null,
        tRich("fileDialog.longLink", { length: "12 kB", b: (c) => createElement("b", null, c) }),
      ),
    ),
    format: {
      number: formatNumber(1234567.891),
      percent: formatPercent(0.4237, 1),
      rate: [formatRate(1234.5), formatRate(2.25)],
      duration: [formatDuration(850), formatDuration(1250), formatDuration(180_000)],
      list: [formatList(["Kafka", "Postgres", "Redis"]), formatList(["Kafka", "Postgres"], "or")],
      importList: formatImportList(["a", "b", "c"]),
      bytes: formatBytes(1_536_000),
      date: formatDate(Date.UTC(2026, 9, 14, 12), { day: "numeric", month: "short", timeZone: "UTC" }),
    },
  };
}

it("messages in every language", async () => {
  const out: Record<string, unknown> = { en: render() };
  for (const code of Object.keys(catalogs).sort()) {
    if (code === "en") continue;
    state.l = code;
    state.c = (await catalogs[code]()).default as Catalog;
    out[code] = render();
  }
  expectGolden("i18n/messages.json", out);
});

/** Sample values for a message's arguments, from its English: numbers for counts, a select's first option. */
function samples(parts: Part[], out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const p of parts) {
    if (p.type === "arg") out[p.name] ??= `‹${p.name}›`;
    else if (p.type === "number") out[p.name] = p.style === "percent" ? 0.25 : 1234;
    else if (p.type === "plural") {
      out[p.name] = 3;
      for (const branch of Object.values(p.options)) samples(branch, out);
    } else if (p.type === "select") {
      out[p.name] = Object.keys(p.options).find((k) => k !== "other") ?? "other";
      for (const branch of Object.values(p.options)) samples(branch, out);
    } else if (p.type === "tag") {
      out[p.name] = (chunks: unknown) => [`<${p.name}>`, chunks, `</${p.name}>`];
      samples(p.children, out);
    }
  }
  return out;
}

const flat = (value: unknown): string => (Array.isArray(value) ? value.map(flat).join("") : String(value));

/** Plural values that reach every category some language uses (zero, one, two, few, many, other) and the = forms. */
const COUNTS = [0, 1, 2, 3, 5, 11, 21, 22, 101, 1000, 1.5];

/**
 * Value sets that reach every branch: the sample values, then each select option and each count in turn for one
 * argument at a time (nested branches included, since every argument is found wherever it is).
 */
function variants(parts: Part[]): Record<string, unknown>[] {
  const base = samples(parts);
  const out = [base];
  const visit = (list: Part[]) => {
    for (const p of list) {
      if (p.type === "select") for (const option of Object.keys(p.options)) out.push({ ...base, [p.name]: option });
      if (p.type === "plural") for (const n of COUNTS) out.push({ ...base, [p.name]: n });
      if (p.type === "plural" || p.type === "select") for (const branch of Object.values(p.options)) visit(branch);
      if (p.type === "tag") visit(p.children);
    }
  };
  visit(parts);
  return out;
}

/**
 * Every message of every language, as the runtime looks it up (by English text for plain messages, by position in
 * the sorted English keys otherwise: scripts/i18n-plugin.ts) and renders every branch of it with sample values. Recorded as one hash
 * per language and area (the key's prefix) so a changed message names its language and area, and as counts of the
 * messages that fall back to English.
 */
it("every message in every language", async () => {
  const keys = Object.keys(en).sort() as (keyof typeof en)[];
  const out: Record<string, unknown> = {};
  const shaped: Record<string, unknown> = {};
  for (const code of Object.keys(catalogs).sort()) {
    if (code === "en") continue;
    const catalog = (await catalogs[code]()).default as Catalog;
    const areas = new Map<string, string[]>();
    let fallback = 0,
      shapedFallback = 0;
    const shapedAreas = new Map<string, string[]>();
    for (const [i, key] of keys.entries()) {
      const parts = parse(en[key]);
      const english = parts.every((p) => p.type === "text")
        ? parts.map((p) => (p.type === "text" ? p.value : "")).join("")
        : undefined;
      const entry = catalog[i] ?? (english !== undefined ? catalog[english] : undefined);
      const route = key.startsWith("route.");
      if (entry === undefined) {
        if (route) shapedFallback++;
        else fallback++;
      }
      const text =
        entry === undefined
          ? "(English)"
          : typeof entry === "string"
            ? entry
            : variants(parts)
                .map((values) => flat(entry(values)))
                .join("");
      const area = key.slice(0, key.indexOf("."));
      const group = route ? shapedAreas : areas;
      const list = group.get(area) ?? [];
      list.push(`${key}\u0000${text}`);
      group.set(area, list);
    }
    shaped[code] = {
      messages: keys.filter((key) => key.startsWith("route.")).length,
      fallback: shapedFallback,
      areas: Object.fromEntries([...shapedAreas].map(([area, lines]) => [area, sha256(lines.join("\n")).slice(0, 12)])),
    };
    out[code] = {
      messages: keys.filter((key) => !key.startsWith("route.")).length,
      fallback,
      areas: Object.fromEntries(
        [...areas].sort(([a], [b]) => (a < b ? -1 : 1)).map(([a, l]) => [a, sha256(l.join("\n")).slice(0, 12)]),
      ),
    };
  }
  // Retain the original catalog cohort; the additive route area is pinned in full alongside it.
  expectGolden("i18n/catalogs.json", out);
  expectGolden("i18n/corpus-hand-shaped-lines.json", shaped);
});
