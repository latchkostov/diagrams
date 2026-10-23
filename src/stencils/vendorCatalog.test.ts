import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { getStencil } from "./registry";
import { iconUrl } from "./iconUrls";
import { VENDOR_PARENTS, baseStencilId, vendorDescriptionParent } from "./vendorParents";
import { profileOf } from "./profiles";
import { holdsThreadByDefault } from "./freeCallerProfiles";
import { inferKind } from "./edgeKind";
import { inferRelation, reinferRelations } from "./relations";
import { stencilExportShape } from "./exportShape";
import { isFirewallStencil } from "./netDevices";
import { stencilRole } from "./roles";
import { newPlanningProps } from "../model/planning";
import { resolveProps } from "../sim/defaults";
import { createEngine } from "../sim/engine";
import { searchStencils, STENCIL_ALIASES } from "../lib/stencilSearch";
import { familyOf } from "../lib/vendorFamilies";
import { findStencils } from "../ai/stencils";
import { iconSource } from "../gallery/stencilInfo";
import { isFrontDoor, isSelfHostedGateway, isService, isSharedByDesign } from "../checks/kinds";
import type { DiagramFile, PlanningModel } from "../model/types";

const variants = Object.entries(VENDOR_PARENTS);
const revisions: (PlanningModel | undefined)[] = [
  undefined,
  { revision: "p1" },
  { revision: "p2" },
  { revision: "p3" },
  { revision: "p3-w2" },
];

describe("popular vendor variants", () => {
  it("publishes the researched batch once, with stable parent records", () => {
    expect(variants).toHaveLength(58);
    expect(new Set(catalog.map((s) => s.id)).size).toBe(catalog.length);
    expect(getStencil("fastly")).toMatchObject({ label: "Fastly", category: "network", simRole: "gateway" });
    expect(getStencil("fastly.compute").description).toBe(getStencil("azure.functions").description);
    expect(getStencil("fastly.compute").description).not.toContain("Cloudflare");
    expect(baseStencilId("not.in.catalog")).toBe("not.in.catalog");
  });

  it.each(variants)("%s inherits %s across creation, playback, relationships and exports", (id, parentId) => {
    const stencil = getStencil(id);
    const parent = getStencil(parentId);
    expect(stencil.id).toBe(id);
    expect(stencil.simRole).toBe(parent.simRole);
    expect(stencilRole(id)).toBe(parent.simRole);
    expect(stencil.defaultSublabel).toBe(parent.defaultSublabel);
    expect(stencil.description).toBe(getStencil(vendorDescriptionParent(id)).description);
    expect(profileOf(id)).toEqual(profileOf(parentId));
    expect(holdsThreadByDefault(id)).toBe(holdsThreadByDefault(parentId));
    expect(isFirewallStencil(id)).toBe(isFirewallStencil(parentId));
    expect(stencilExportShape(id)).toBe(stencilExportShape(parentId));
    expect(isFrontDoor(id, stencil.simRole)).toBe(isFrontDoor(parentId, parent.simRole));
    expect(isSelfHostedGateway(id)).toBe(isSelfHostedGateway(parentId));
    expect(isService(id, stencil.simRole)).toBe(isService(parentId, parent.simRole));
    expect(isSharedByDesign(id)).toBe(isSharedByDesign(parentId));
    for (const other of ["generic.service", "generic.queue", "client.browser", "generic.config-store"]) {
      expect(inferKind(id, other)).toBe(inferKind(parentId, other));
      expect(inferKind(other, id)).toBe(inferKind(other, parentId));
      expect(inferRelation(id, other)).toBe(inferRelation(parentId, other));
      expect(inferRelation(other, id)).toBe(inferRelation(other, parentId));
    }
    const edges = [{ id: "e", from: "caller", to: "target" }];
    const of = (target: string) => (node: string) => (node === "target" ? target : "generic.service");
    expect(reinferRelations(edges, of(id), new Set(["target"]))).toEqual(
      reinferRelations(edges, of(parentId), new Set(["target"])),
    );
    for (const planning of revisions) {
      expect(newPlanningProps(stencil.simRole, planning, id)).toEqual(
        newPlanningProps(parent.simRole, planning, parentId),
      );
      for (const props of [{}, { latencyMs: 80, failureRate: 0, concurrency: 3, partitions: 2 }])
        expect(resolveProps(stencil.simRole, "Work", props, id, planning)).toEqual(
          resolveProps(parent.simRole, "Work", props, parentId, planning),
        );
    }
  });

  it.each(variants)("%s is discoverable and has a licensed neutral glyph", (id) => {
    const stencil = getStencil(id);
    expect(stencil.accent).toMatch(/^#[0-9A-F]{6}$/i);
    expect(familyOf(stencil)).not.toBe("other");
    expect(STENCIL_ALIASES[id].length).toBeGreaterThan(0);
    for (const query of [stencil.label, ...STENCIL_ALIASES[id]])
      expect(
        searchStencils(catalog, query).map((s) => s.id),
        query,
      ).toContain(id);
    expect(findStencils(stencil.label).map((s) => s.id)).toContain(id);
    expect(iconSource(stencil.icon)).toEqual({ source: "Lucide", licence: "ISC" });
    expect(iconUrl(stencil.icon)).toBeTruthy();
    expect(readFileSync(`src/stencils/icons/${stencil.icon}.svg`, "utf8")).toContain("<svg");
    const licences = readFileSync("docs/ICONS.md", "utf8");
    expect(licences).toContain(`\`${id}\``);
    expect(licences).toContain(`\`${stencil.icon}.svg\``);
  });

  it.each(variants)("%s replays identically to its parent", (id, parentId) => {
    const replay = (stencil: string) => {
      const d: DiagramFile = {
        format: "diagrams/v1",
        title: "Vendor parity",
        planning: { revision: "p3-w2" },
        nodes: [
          { id: "caller", stencil: "client.browser", label: "Caller", x: 0, y: 0, props: { ratePerSec: 4 } },
          { id: "work", stencil, label: "Work", x: 300, y: 0, props: { latencyMs: 20, ratePerSec: 2, failureRate: 0 } },
          { id: "end", stencil: "generic.database", label: "End", x: 600, y: 0 },
        ],
        edges: [
          { id: "in", from: "caller", to: "work", kind: "async" },
          { id: "out", from: "work", to: "end", kind: "async" },
        ],
      };
      const engine = createEngine({ seed: 7 });
      engine.load(d);
      engine.setTraffic(true);
      for (let i = 0; i < 800; i++) engine.step(10);
      return engine.snapshot();
    };
    expect(replay(id)).toEqual(replay(parentId));
  });
});
