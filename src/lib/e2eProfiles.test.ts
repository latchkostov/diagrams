import { readFileSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { E2E_PROFILES, e2eBuild } from "../../scripts/e2e-profiles.mjs";
import { buildE2E } from "../../scripts/e2e-build.mjs";
import { options, plan } from "../../scripts/gate/logic.mjs";

it("gate, Playwright and the CI build entry consume the same profile environments and output dirs", async () => {
  vi.stubEnv("E2E_TARGET", "build");
  vi.stubEnv("E2E_PREBUILT", "");
  const profile = E2E_PROFILES.locked;
  const original = { ...profile, env: { ...profile.env } };
  profile.env.PROFILE_CONTRACT = "shared-value";
  profile.outDir = "tests/.output/profile-contract";
  try {
    const { default: config } = await import("../../playwright.config");
    const builds = plan(options(["full"])).flat();
    const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
    const action = readFileSync(".github/actions/e2e/action.yml", "utf8");
    for (const [name, profile] of Object.entries(E2E_PROFILES)) {
      const build = e2eBuild(name);
      expect(builds.find((step) => step.name === `${name}-build`)).toEqual({ name: `${name}-build`, ...build });
      const server = servers.find((s) => s?.command.includes(`scripts/e2e-build.mjs ${name} &&`));
      expect(server?.command).toContain(`--outDir ${profile.outDir}`);
      expect(server?.env).toMatchObject(profile.env);
      expect(
        await buildE2E(name, async (bin, args, { env }) => {
          expect(bin).toBe(process.execPath);
          expect(args).toEqual([resolve("node_modules/vite/bin/vite.js"), ...build.args.slice(2)]);
          expect(env).toEqual(profile.env);
          return { code: 7 };
        }),
      ).toBe(7);
      expect(action).toContain(`node scripts/e2e-build.mjs ${name}`);
    }
    expect(action).not.toMatch(/VITE_(?:E2E|DISABLE_|BRAND_|LOCALES)/);
    expect(() => e2eBuild("unknown")).toThrow("Unknown");
  } finally {
    profile.outDir = original.outDir;
    profile.env = original.env;
    vi.unstubAllEnvs();
  }
});
