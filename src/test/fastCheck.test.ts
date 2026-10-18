import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { fastCheckConfig, propertyRuns } from "./fastCheck";

describe("shared fast-check configuration", () => {
  it("is installed for every Vitest file", () => {
    expect(fc.readConfigureGlobal()).toEqual(fastCheckConfig(process.env));
  });

  it("pins CI, keeps local seeds random, and permits explicit reproduction in either", () => {
    expect(fastCheckConfig({ CI: "1" }).seed).toBe(20261018);
    expect(fastCheckConfig({}).seed).toBeUndefined();
    for (const CI of [undefined, "1"]) {
      expect(fastCheckConfig({ CI, FC_SEED: "-673370871", FC_PATH: "840:7:7:6:5:5:6" })).toMatchObject({
        seed: -673370871,
        path: "840:7:7:6:5:5:6",
      });
      expect(fastCheckConfig({ CI, FC_SEED: "0" }).seed).toBe(0);
    }
  });

  it("Nightly explores random seeds at twenty times each property's usual coverage", () => {
    const env = { CI: "true", FC_SEED: "random", FC_RUN_MULTIPLIER: "20" };
    expect(fastCheckConfig(env)).toEqual({ numRuns: 2000 });
    expect(propertyRuns(1000, env)).toBe(20_000);
    expect(propertyRuns(500, env)).toBe(10_000);
    expect(propertyRuns(500, {})).toBe(500);
  });

  it("rejects malformed overrides instead of silently running another corpus", () => {
    for (const FC_SEED of ["oops", "", "1.5", "2147483648", "-2147483649"])
      expect(() => fastCheckConfig({ FC_SEED })).toThrow(/FC_SEED/);
    for (const FC_RUN_MULTIPLIER of ["0", "-1", "1.5", "oops"])
      expect(() => propertyRuns(500, { FC_RUN_MULTIPLIER })).toThrow(/FC_RUN_MULTIPLIER/);
  });
});
