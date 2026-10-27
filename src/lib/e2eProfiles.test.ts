import { readFileSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { parse } from "yaml";
import { command } from "../../scripts/gate/commands.mjs";

vi.mock("../../scripts/gate/commands.mjs", () => ({ command: vi.fn() }));

it.each(["build", "dev"])("gate, Playwright and the CI build entry share profiles (target: %s)", async (target) => {
  vi.resetModules();
  vi.stubEnv("E2E_TARGET", target);
  vi.stubEnv("E2E_PREBUILT", "");
  const { E2E_PROFILES, e2eBuild } = await import("../../scripts/e2e-profiles.mjs");
  const { buildE2E } = await import("../../scripts/e2e-build.mjs");
  const { buildArtifacts } = await import("../../scripts/ci/e2e-builds.mjs");
  const { options, plan } = await import("../../scripts/gate/logic.mjs");
  const profile = E2E_PROFILES.locked;
  const original = { ...profile, env: { ...profile.env } };
  profile.env.PROFILE_CONTRACT = "shared-value";
  profile.outDir = "tests/.output/profile-contract";
  try {
    const { default: config } = await import("../../playwright.config");
    const builds = plan(options(["full"])).flat();
    const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
    const action = readFileSync(".github/actions/e2e/action.yml", "utf8");
    const steps = parse(action).runs.steps as { name?: string; run?: string }[];
    expect(steps.find((step) => step.name === "Local builds")?.run).toContain(
      'node scripts/ci/e2e-builds.mjs build "$TARGET" "${specs[@]}"',
    );
    const execute = vi.mocked(command).mockReset().mockResolvedValue({ code: 0, text: "", stdout: "", stderr: "" });
    // Exercise CI's default builder through the shared entry, stopping only at process execution.
    await buildArtifacts([], undefined, target);
    expect(execute).toHaveBeenCalledTimes(Object.keys(E2E_PROFILES).length);
    for (const [name, profile] of Object.entries(E2E_PROFILES)) {
      const build = e2eBuild(name);
      expect(execute).toHaveBeenCalledWith(
        process.execPath,
        [resolve("node_modules/vite/bin/vite.js"), ...build.args.slice(2)],
        {
          env: profile.env,
          live: true,
        },
      );
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
    }
    expect(action).not.toMatch(/VITE_(?:E2E|DISABLE_|BRAND_|LOCALES)/);
    expect(() => e2eBuild("unknown")).toThrow("Unknown");
  } finally {
    profile.outDir = original.outDir;
    profile.env = original.env;
    vi.unstubAllEnvs();
  }
});
