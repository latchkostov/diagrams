/** Shared production builds served by Playwright, CI and the portable gate. */
export const E2E_PROFILES = {
  e2e: { outDir: "tests/.output/e2e-dist", env: { VITE_E2E: "1" } },
  preview: { outDir: "tests/.output/preview-dist", env: { VITE_E2E: "" } },
  internal: {
    outDir: "tests/.output/internal-dist",
    env: {
      VITE_E2E: "",
      VITE_DISABLE_SHARE_LINKS: "1",
      VITE_DISABLE_AI_TOOLS: "1",
      VITE_PRIVATE_BY_DEFAULT: "1",
      VITE_BRAND_NAME: "Acme Diagrams (internal)",
      VITE_LOCALES: "en,de",
    },
  },
  locked: {
    outDir: "tests/.output/locked-dist",
    env: {
      VITE_E2E: "",
      VITE_DISABLE_SHARE_LINKS: "1",
      VITE_DISABLE_LINK_OPEN: "1",
      VITE_DISABLE_AI_TOOLS: "1",
      VITE_DISABLE_ONDEVICE: "1",
      VITE_PRIVATE_BY_DEFAULT: "1",
      VITE_LOCALES: "en",
    },
  },
};

/** An empty or nonliteral filter can match either spec, as in Playwright. */
export function selfHostProfiles(specs) {
  const unfiltered = !specs.length || specs.some((spec) => !/^tests\/e2e\/[\w/-]+\.spec\.ts$/.test(spec));
  return [
    ["internal", "tests/e2e/self-host.spec.ts"],
    ["locked", "tests/e2e/self-host-locked.spec.ts"],
  ]
    .filter(([, spec]) => unfiltered || specs.includes(spec))
    .map(([name]) => name);
}

export function e2eBuild(name) {
  const profile = Object.hasOwn(E2E_PROFILES, name) && E2E_PROFILES[name];
  if (!profile) throw new Error(`Unknown E2E build profile: ${name}`);
  return {
    args: ["exec", "vite", "build", "--outDir", profile.outDir, "--emptyOutDir", "--logLevel", "error"],
    env: profile.env,
  };
}
