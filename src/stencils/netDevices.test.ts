import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { find_stencilsSchema } from "../ai/schemas";
import { findStencils } from "../ai/stencils";
import { CATEGORY_ORDER } from "../lib/categories";
import { iconSource } from "../gallery/stencilInfo";
import { inferStencil } from "../interop/infer";
import { parseStyle, stencilFromStyle } from "../interop/drawio/mapping";
import { searchStencils } from "../lib/stencilSearch";
import { familyOf } from "../lib/vendorFamilies";
import { catalog } from "./catalog";
import {
  activeUnits,
  DEVICE_SIZES,
  DEVICE_SPECS,
  deviceSpec,
  isFirewallStencil,
  messagesPerSec,
  presetOf,
  sizeOf,
  sizesOf,
} from "./netDevices";

const devices = catalog.filter((s) => s.category === "onprem");
const icons = join(process.cwd(), "src", "stencils", "icons");

describe("network device stencils", () => {
  it("has a device spec for every on-prem stencil, and a stencil for every spec", () => {
    expect(devices.map((s) => s.id).sort()).toEqual(Object.keys(DEVICE_SPECS).sort());
    expect(devices.length).toBeGreaterThanOrEqual(19);
  });

  it("covers the four device types, each with a generic stencil, and the major vendors", () => {
    const kinds = new Map(devices.map((s) => [s.id, deviceSpec(s.id)!.kind]));
    for (const kind of ["router", "switch", "firewall", "adc"])
      expect(
        devices.some((s) => s.vendor === "Generic" && kinds.get(s.id) === kind),
        kind,
      ).toBe(true);
    const vendors = new Set(devices.map((s) => s.vendor));
    for (const v of [
      "Cisco",
      "Juniper",
      "Palo Alto Networks",
      "Fortinet",
      "F5",
      "Arista",
      "Check Point",
      "HPE Aruba",
      "NetScaler",
    ])
      expect(vendors.has(v), v).toBe(true);
  });

  it("makes every device a pass-through gateway in the network vendors family (or generic)", () => {
    for (const s of devices) {
      expect(s.simRole, s.id).toBe("gateway");
      expect(familyOf(s), s.id).toBe(s.vendor === "Generic" ? "generic" : "network");
    }
  });

  it("uses device glyphs, not vendor logos, each a file with a licence on record", () => {
    for (const s of devices) {
      expect(s.icon, s.id).toMatch(/^net-(router|switch|firewall|adc)$/);
      expect(existsSync(join(icons, `${s.icon}.svg`)), s.icon).toBe(true);
    }
    expect(iconSource("net-router")).toEqual({ source: "Live Diagrams", licence: "MIT" });
    expect(iconSource("net-switch")).toEqual({ source: "Live Diagrams", licence: "MIT" });
    expect(iconSource("net-adc")).toEqual({ source: "Live Diagrams", licence: "MIT" });
    expect(iconSource("net-firewall")).toEqual({ source: "Lucide", licence: "ISC" });
    const doc = readFileSync(join(process.cwd(), "docs", "ICONS.md"), "utf8");
    for (const icon of new Set(devices.map((s) => s.icon))) expect(doc, icon).toContain(`\`${icon}.svg\``);
  });

  it("normalises the icons like the rest: a viewBox, no fixed size, no scripts", () => {
    for (const icon of ["net-router", "net-switch", "net-firewall", "net-adc"]) {
      const svg = readFileSync(join(icons, `${icon}.svg`), "utf8");
      expect(svg, icon).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"/);
      expect(svg.match(/^<svg[^>]*>/)![0], icon).not.toMatch(/\swidth=|\sheight=/);
      expect(svg, icon).not.toMatch(/<script|<title|<image/);
    }
  });
});

describe("size presets", () => {
  it("gives every family its default size, sizes that grow, and positive latency", () => {
    for (const [id, spec] of Object.entries(DEVICE_SPECS)) {
      expect(spec.presets[spec.size], id).toBeDefined();
      const sizes = sizesOf(spec);
      expect(sizes.length, id).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < sizes.length; i++)
        expect(presetOf(spec, sizes[i]).gbps, id).toBeGreaterThan(presetOf(spec, sizes[i - 1]).gbps);
      for (const s of sizes) {
        expect(presetOf(spec, s).latencyMs, id).toBeGreaterThan(0);
        expect(presetOf(spec, s).model, id).not.toBe("");
      }
    }
  });

  it("orders sizes branch, campus, data centre, and falls back to the family's own", () => {
    expect(DEVICE_SIZES).toEqual(["branch", "campus", "datacentre"]);
    expect(sizesOf(DEVICE_SPECS["cisco.nexus"])).toEqual(["campus", "datacentre"]);
    expect(sizeOf(DEVICE_SPECS["cisco.nexus"], "branch")).toBe("datacentre");
    expect(sizeOf(DEVICE_SPECS["cisco.isr"], "campus")).toBe("campus");
    expect(sizeOf(DEVICE_SPECS["cisco.isr"], "huge")).toBe("branch");
  });

  it("converts throughput to messages per second at a message size", () => {
    // 1 Gbps is 125,000,000 bytes/s: 1,953.125 messages of 64 kB.
    expect(messagesPerSec(1, 64)).toBeCloseTo(1953.125);
    expect(messagesPerSec(0.8, 1000)).toBeCloseTo(100);
    expect(messagesPerSec(1)).toBeCloseTo(1953.125);
    expect(messagesPerSec(1, 0)).toBe(Infinity);
  });

  it("counts one unit of an active-standby pair, every unit otherwise", () => {
    expect(activeUnits("active-standby", 2)).toBe(1);
    expect(activeUnits("active-active", 3)).toBe(3);
    expect(activeUnits("standalone", 1)).toBe(1);
  });

  it("knows its firewalls, the existing Firewall / WAF included", () => {
    expect(isFirewallStencil("paloalto.ngfw")).toBe(true);
    expect(isFirewallStencil("generic.firewall")).toBe(true);
    expect(isFirewallStencil("cisco.isr")).toBe(false);
    expect(isFirewallStencil(undefined)).toBe(false);
  });
});

describe("finding them", () => {
  const top = (q: string) => searchStencils(catalog, q)[0]?.id;

  it.each([
    ["3825", "cisco.isr"],
    ["ISR", "cisco.isr"],
    ["cisco 3825", "cisco.isr"],
    ["router", "generic.router"],
    ["NGFW", "generic.ngfw"],
    ["BIG-IP", "f5.bigip"],
    ["f5", "f5.bigip"],
    ["fortigate", "fortinet.fortigate"],
    ["palo alto", "paloalto.ngfw"],
    ["asa", "cisco.secure-firewall"],
    ["nexus", "cisco.nexus"],
    ["netscaler", "netscaler.adc"],
    ["switch", "generic.switch"],
  ])("%s finds %s first", (q, id) => expect(top(q)).toBe(id));

  it("finds spine and leaf switches", () => {
    for (const q of ["spine", "leaf"]) {
      const hits = searchStencils(catalog, q).map((s) => s.id);
      for (const id of ["generic.switch", "cisco.nexus", "arista.switch", "juniper.qfx"]) expect(hits, q).toContain(id);
    }
  });

  it("lets agents filter by every category, the new one included", () => {
    const category = (find_stencilsSchema.properties as Record<string, { enum: string[] }>).category;
    expect(category.enum).toEqual([...CATEGORY_ORDER]);
    expect(new Set(catalog.map((s) => s.category))).toEqual(new Set(CATEGORY_ORDER));
  });

  it("lists the device stencils for agents (find_stencils), by category too", () => {
    expect(findStencils("3825")[0]).toMatchObject({ id: "cisco.isr", simRole: "gateway", category: "onprem" });
    expect(findStencils("firewall", { category: "onprem", limit: 10 }).map((s) => s.id)).toContain("paloalto.ngfw");
  });
});

describe("imports", () => {
  it("reads draw.io's Cisco shapes as the generic devices", () => {
    const hit = (style: string) => stencilFromStyle(parseStyle(style))?.stencil;
    expect(hit("shape=mxgraph.cisco.routers.router;html=1")).toBe("generic.router");
    expect(hit("shape=mxgraph.cisco.switches.layer_3_switch;html=1")).toBe("generic.switch");
    expect(hit("shape=mxgraph.cisco.security.firewall;html=1")).toBe("generic.ngfw");
    expect(hit("shape=mxgraph.cisco.misc.asa_5500;html=1")).toBe("generic.ngfw");
    expect(hit("shape=mxgraph.cisco.misc.load_balancer;html=1")).toBe("generic.adc");
    expect(hit("shape=mxgraph.cisco19.rect;prIcon=router;html=1")).toBe("generic.router");
  });

  it.each([
    ["Palo Alto PA-3440", "paloalto.ngfw"],
    ["FortiGate 400F", "fortinet.fortigate"],
    ["Cisco ASA 5525", "cisco.secure-firewall"],
    ["F5 BIG-IP LTM", "f5.bigip"],
    ["Cisco 3825", "cisco.isr"],
    ["Nexus 9300 leaf", "cisco.nexus"],
    ["Arista spine", "arista.switch"],
    ["core switch", "generic.switch"],
    ["WAN router", "generic.router"],
    ["NGFW", "generic.ngfw"],
  ])("infers %s as %s", (text, id) => expect(inferStencil(text)).toBe(id));

  it("leaves words that aren't devices alone", () => {
    expect(inferStencil("Order router")).not.toBe("generic.router");
    expect(inferStencil("Feature switch")).toBeUndefined();
  });
});
