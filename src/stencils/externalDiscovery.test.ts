import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { categoryLabel, clientSections } from "../lib/categories";
import { searchStencils } from "../lib/stencilSearch";
import { familyOf } from "../lib/vendorFamilies";
import { findStencils } from "../ai/stencils";
import { iconSource } from "../gallery/stencilInfo";

const vendors = ["iterable", "braze", "segment", "shopify", "paypal", "adyen"];
const fallbacks = ["external-api", "email", "sms", "push", "marketing", "webhook", "llm"].map((id) => `generic.${id}`);
const external = [
  ...fallbacks,
  ...vendors,
  "client.partner",
  "stripe",
  "twilio",
  "sendgrid",
  "salesforce",
  "hubspot",
  "slack",
  "openai",
  "anthropic.claude",
];

describe("external discovery", () => {
  it("keeps stable fallback ids together with clients and external vendors", () => {
    expect(categoryLabel.clients).toBe("Clients & external");
    for (const id of external) expect(catalog.find((s) => s.id === id)?.category, id).toBe("clients");
    // Identity dependencies keep their existing home.
    for (const id of ["okta", "auth0"]) expect(catalog.find((s) => s.id === id)?.category).toBe("security");
  });

  it("separates source clients and webhooks from called external systems without losing entries", () => {
    const clients = catalog.filter((s) => s.category === "clients");
    const sections = clientSections(clients);
    expect(sections.map((s) => s.id)).toEqual(["sources", "external"]);
    expect(sections[0].items.map((s) => s.id)).toContain("generic.webhook");
    expect(sections[1].items[0].id).toBe("generic.external-api");
    expect(sections[1].items.map((s) => s.id)).toEqual(expect.arrayContaining(vendors));
    expect(sections.flatMap((s) => s.items)).toHaveLength(clients.length);
    expect(clientSections(clients.filter((s) => s.simRole === "sink"))).toHaveLength(1);
  });

  it("keeps ordinary clients out of external search while retaining the inbound webhook", () => {
    const hits = searchStencils(catalog, "external").map((s) => s.id);
    expect(hits).toContain("generic.webhook");
    for (const id of ["client.user", "client.browser", "client.mobile", "client.iot", "client.team"])
      expect(hits).not.toContain(id);
    expect(searchStencils(catalog, "clients").map((s) => s.id)).toContain("client.browser");
  });

  it.each(vendors)("ships %s as metadata with an existing terminal role and licensed reusable artwork", (id) => {
    const stencil = catalog.find((s) => s.id === id);
    expect(stencil).toMatchObject({ id, category: "clients", simRole: "sink" });
    expect(stencil!.label.toLowerCase()).toBe(id);
    expect(stencil!.vendor).toBe(stencil!.label);
    expect(stencil!.defaultSublabel).toBeTruthy();
    expect(stencil!.description).toBeTruthy();
    expect(stencil!.description).not.toMatch(/\d/);
    expect(familyOf(stencil!)).toBe("saas");
    expect(iconSource(stencil!.icon)).toEqual({ source: "Lucide", licence: "ISC" });
    expect(readFileSync(`src/stencils/icons/${stencil!.icon}.svg`, "utf8")).toContain("<svg");
    expect(findStencils(id, { category: "clients" })[0]?.id).toBe(id);
  });

  it.each([
    "external",
    "third party",
    "third-party API",
    "API",
    "SaaS",
    "webhook",
    "vendor API",
    "REST API",
    "HTTP API",
  ])("finds external stencils by %s on all shared search surfaces", (query) => {
    expect(searchStencils(catalog, query).map((s) => s.id)).toEqual(expect.arrayContaining(external));
    expect(findStencils(query, { category: "clients", limit: 10 }).map((s) => s.id)).toContain("generic.external-api");
  });

  it("makes identity APIs discoverable without moving dependencies", () => {
    for (const query of ["Okta API", "Auth0 API", "vendor API"])
      expect(searchStencils(catalog, query).map((s) => s.id)).toEqual(
        expect.arrayContaining(
          query === "vendor API" ? ["okta", "auth0"] : [query.startsWith("Okta") ? "okta" : "auth0"],
        ),
      );
  });
});
