import { describe, expect, it } from "vitest";
import { catalog } from "../stencils/catalog";
import {
  FAMILIES,
  familyCounts,
  familyOf,
  familyOfVendor,
  getFamily,
  isFamilyId,
  vendorsByFamily,
} from "./vendorFamilies";

describe("vendor families", () => {
  it("maps every catalog vendor to a real family (none fall through to 'other')", () => {
    const unmapped = [...new Set(catalog.map((s) => s.vendor))].filter((v) => familyOfVendor(v) === "other");
    expect(unmapped).toEqual([]);
  });

  it("puts well-known vendors in the expected family", () => {
    expect(familyOfVendor("Azure")).toBe("azure");
    expect(familyOfVendor("Microsoft")).toBe("azure");
    expect(familyOfVendor("AWS")).toBe("aws");
    expect(familyOfVendor("Google Cloud")).toBe("gcp");
    expect(familyOfVendor("Apache Kafka")).toBe("streaming");
    expect(familyOfVendor("RabbitMQ")).toBe("streaming");
    expect(familyOfVendor("PostgreSQL")).toBe("oss");
    expect(familyOfVendor("Kubernetes")).toBe("oss");
    expect(familyOfVendor("Snowflake")).toBe("saas");
    expect(familyOfVendor("Confluent")).toBe("streaming");
    expect(familyOfVendor("Apache Flink")).toBe("streaming");
    expect(familyOfVendor("Istio")).toBe("oss");
    expect(familyOfVendor("Temporal")).toBe("oss");
    expect(familyOfVendor("Stripe")).toBe("saas");
    expect(familyOfVendor("Anthropic")).toBe("saas");
    expect(familyOfVendor("Generic")).toBe("generic");
    expect(familyOfVendor("Client")).toBe("generic");
  });

  it("sends unknown vendors to 'other'", () => {
    expect(familyOfVendor("Acme Quantum Bus")).toBe("other");
    expect(getFamily("other").label).toBe("Other");
  });

  it("keeps the filter row short", () => {
    const shown = familyCounts(catalog);
    expect(shown.length).toBeLessThanOrEqual(8);
    expect(shown.map((f) => f.family.id)).not.toContain("other");
    expect(shown.reduce((n, f) => n + f.count, 0)).toBe(catalog.length);
  });

  it("groups vendors by family with counts that add up", () => {
    const groups = vendorsByFamily(catalog);
    const total = groups.flatMap((g) => g.vendors).reduce((n, v) => n + v.count, 0);
    expect(total).toBe(catalog.length);
    for (const g of groups) for (const v of g.vendors) expect(familyOfVendor(v.vendor)).toBe(g.family.id);
  });

  it("validates family ids", () => {
    expect(FAMILIES.every((f) => isFamilyId(f.id))).toBe(true);
    expect(isFamilyId("all")).toBe(false);
    expect(isFamilyId(undefined)).toBe(false);
    expect(familyOf({ vendor: "AWS" })).toBe("aws");
  });
});
