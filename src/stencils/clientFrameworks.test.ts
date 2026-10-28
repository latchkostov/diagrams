import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { getStencil } from "./registry";
import { iconUrl } from "./iconUrls";
import { stencilRole } from "./roles";
import { profileOf } from "./profiles";
import { inferKind } from "./edgeKind";
import { inferRelation, reinferRelations } from "./relations";
import { stencilExportShape } from "./exportShape";
import { iconSource } from "../gallery/stencilInfo";
import { searchStencils } from "../lib/stencilSearch";
import { clientSections } from "../lib/categories";
import { familyOf } from "../lib/vendorFamilies";
import { findStencils } from "../ai/stencils";
import { stencilLabel } from "../i18n/stencils";
import { stencilDescription } from "../i18n/stencilDescriptions";
import { createEngine } from "../sim/engine";
import { resolveNodeProps } from "../sim/defaults";
import type { DiagramFile } from "../model/types";
import orders from "../examples/aws-serverless-orders.json";
import { exampleShows } from "../../scripts/example-shows";

const frameworks = [
  ["react", "React", "browser"],
  ["vue", "Vue", "browser"],
  ["angular", "Angular", "browser"],
  ["svelte", "Svelte", "browser"],
  ["nextjs", "Next.js", "browser"],
  ["nuxt", "Nuxt", "browser"],
  ["react-native", "React Native", "mobile"],
  ["flutter", "Flutter", "mobile"],
  ["swiftui", "SwiftUI (iOS)", "mobile"],
  ["compose", "Jetpack Compose (Android)", "mobile"],
] as const;

// Published search terms are a contract independent of the implementation's alias table.
const advertisedAliases: Record<string, string[]> = {
  react: ["reactjs", "react.js", "jsx", "spa", "frontend"],
  vue: ["vuejs", "vue.js", "spa", "frontend"],
  angular: ["angularjs", "spa", "frontend"],
  svelte: ["sveltekit", "spa", "frontend"],
  nextjs: ["next", "next.js", "react", "ssr", "frontend"],
  nuxt: ["nuxtjs", "nuxt.js", "vue", "ssr", "frontend"],
  "react-native": ["reactnative", "ios", "android", "app", "phone"],
  flutter: ["dart", "ios", "android", "app", "phone"],
  swiftui: ["swift", "swift ui", "ios", "iphone", "app", "phone"],
  compose: ["jetpack", "kotlin", "android", "app", "phone"],
};

function diagram(stencil: string): DiagramFile {
  return {
    format: "diagrams/v2",
    planning: { revision: "p3-w2" },
    title: "Client behaviour",
    nodes: [
      { id: "client", stencil, label: "Client", x: 0, y: 0 },
      { id: "api", stencil: "generic.service", label: "API", x: 320, y: 0 },
    ],
    edges: [{ id: "request", from: "client", to: "api", kind: "sync" }],
  };
}

function run(d: DiagramFile) {
  const engine = createEngine({ seed: 7 });
  engine.load(d);
  engine.setTraffic(true);
  for (let i = 0; i < 800; i++) engine.step(10);
  return engine.snapshot();
}

describe.each(frameworks)("%s client stencil", (id, label, parentId) => {
  const stencilId = `client.${id}`;
  const parent = `client.${parentId}`;

  it("registers a source in Clients beside its generic parent", () => {
    const stencil = getStencil(stencilId);
    expect(stencil).toMatchObject({ id: stencilId, label, category: "clients", simRole: "source" });
    expect(stencilRole(stencilId)).toBe("source");
    expect(profileOf(stencilId)).toEqual(profileOf(parent));
    expect(stencil.defaultSublabel).toBe(getStencil(parent).defaultSublabel);
    expect(clientSections(catalog.filter((s) => s.category === "clients"))[0].items).toContain(stencil);
    expect(familyOf(stencil)).toBe("generic");
    expect(stencilLabel(stencil)).toBe(label);
    expect(stencilDescription(stencil)).toBe(stencil.description);
  });

  it("finds the brand and every alias in the panel and agent searches", () => {
    for (const query of [label, ...advertisedAliases[id]]) {
      expect(
        searchStencils(catalog, query).map((s) => s.id),
        query,
      ).toContain(stencilId);
      expect(
        findStencils(query, { limit: 100 }).map((s) => s.id),
        query,
      ).toContain(stencilId);
    }
  });

  it("has a bundled icon with a documented source and licence", () => {
    const { icon } = getStencil(stencilId);
    expect(iconUrl(icon)).toBeTruthy();
    const svg = readFileSync(`src/stencils/icons/${icon}.svg`, "utf8");
    expect(svg).toContain("<svg");
    const ids = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    for (const ref of svg.matchAll(/url\(#([^)]+)\)|(?:\w+:)?href="#([^"]+)"/g)) {
      expect(ids, `${icon}: ${ref[1] ?? ref[2]}`).toContain(ref[1] ?? ref[2]);
    }
    expect(readFileSync("docs/ICONS.md", "utf8")).toContain(`\`${icon}.svg\``);
    expect(iconSource(icon).source).toBeTruthy();
    expect(iconSource(icon).licence).toMatch(/CC|MIT|ISC/);
  });

  it("keeps defaults, traffic, relationships, reinference and export shape equal to its parent", () => {
    const branded = diagram(stencilId);
    const generic = diagram(parent);
    expect(resolveNodeProps(branded, branded.nodes[0])).toEqual(resolveNodeProps(generic, generic.nodes[0]));
    const actual = run(branded);
    expect(actual.nodes.client.role).toBe("source");
    expect(actual.nodes.api.processed).toBeGreaterThan(0);
    expect(actual).toEqual(run(generic));
    for (const target of catalog) {
      expect(inferKind(stencilId, target.id)).toBe(inferKind(parent, target.id));
      expect(inferKind(target.id, stencilId)).toBe(inferKind(target.id, parent));
      expect(inferRelation(stencilId, target.id)).toBe(inferRelation(parent, target.id));
      expect(inferRelation(target.id, stencilId)).toBe(inferRelation(target.id, parent));
    }
    expect(stencilExportShape(stencilId)).toBe(stencilExportShape(parent));
    expect(
      reinferRelations(
        branded.edges,
        (node) => (node === "client" ? stencilId : "generic.service"),
        new Set(["client"]),
      ),
    ).toEqual([]);
  });
});

it.each(["vue", "angular", "svelte"])("also finds the generic browser by %s", (query) => {
  expect(searchStencils(catalog, query).map((s) => s.id)).toContain("client.browser");
});

it("shows a Next.js storefront sending orders within eight seconds in the existing public example", () => {
  const d = orders as DiagramFile;
  expect(d.nodes.find((n) => n.id === "client")?.stencil).toBe("client.nextjs");
  expect(exampleShows(d)).toContain("brandedClients");
  expect(run(d).nodes["create-order"].processed).toBeGreaterThan(0);
});
