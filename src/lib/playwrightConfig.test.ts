import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

it.each([
  { target: "build", only: "1", projects: ["chromium"], servers: [6360] },
  { target: "dev", only: "1", projects: ["chromium"], servers: [6360] },
  {
    target: "build",
    only: "",
    projects: ["chromium", "dev", "subpath", "internal", "locked"],
    servers: [6361, 6360, 6362, 6363, 6364],
  },
])("serves exactly the requested projects ($target, chromium only: $only)", async (mode) => {
  vi.resetModules();
  for (const [key, value] of Object.entries({
    CI: "",
    E2E_TARGET: mode.target,
    E2E_CHROMIUM_ONLY: mode.only,
    E2E_SKIP_PREVIEW: "",
    E2E_SELF_HOST: "internal,locked",
    E2E_PREBUILT: "",
    E2E_GATE: "",
    E2E_PORT: "6360",
    E2E_DEV_PORT: "6361",
    E2E_PREVIEW_PORT: "6362",
    E2E_INTERNAL_PORT: "6363",
    E2E_LOCKED_PORT: "6364",
  }))
    vi.stubEnv(key, value);
  const { default: config } = await import("../../playwright.config");
  if (process.platform === "win32")
    expect(config.use?.launchOptions?.args?.some((arg) => arg.endsWith(",TcpPortRandomizationWin"))).toBe(true);
  expect(config.projects?.map((project) => project.name)).toEqual(mode.projects);
  const servers = Array.isArray(config.webServer) ? config.webServer : [];
  expect(servers.map((server) => Number(new URL(server.url!).port))).toEqual(mode.servers);
  if (mode.target === "build" && mode.only) {
    expect(servers[0].command).toContain("node scripts/e2e-build.mjs e2e");
    expect(servers[0].command).toContain("vite preview");
    expect(servers[0].env?.VITE_E2E).toBe("1");
    vi.stubEnv("E2E_CHROMIUM_ONLY", "");
    vi.resetModules();
    const { default: normal } = await import("../../playwright.config");
    expect(config.projects).toEqual(normal.projects?.filter((project) => project.name === "chromium"));
  }
});

it.each(["build", "dev"])("gate mode owns every webServer and forbids focused tests (%s)", async (target) => {
  vi.resetModules();
  for (const [key, value] of Object.entries({
    CI: "",
    E2E_GATE: "1",
    E2E_TARGET: target,
    E2E_CHROMIUM_ONLY: "",
    E2E_SKIP_PREVIEW: "",
    E2E_SELF_HOST: "internal,locked",
    E2E_PREBUILT: "1",
    E2E_PORT: "6360",
    E2E_DEV_PORT: "6361",
    E2E_PREVIEW_PORT: "6362",
    E2E_INTERNAL_PORT: "6363",
    E2E_LOCKED_PORT: "6364",
  }))
    vi.stubEnv(key, value);
  const { default: config } = await import("../../playwright.config");
  const servers = Array.isArray(config.webServer) ? config.webServer : [];
  expect(servers).toHaveLength(target === "build" ? 5 : 4);
  for (const server of servers) expect(server.reuseExistingServer, server.url).toBe(false);
  expect(config.forbidOnly).toBe(true);
  if (target === "build") {
    const app = servers.find((server) => server.url === "http://localhost:6360");
    expect(app?.command).toContain("vite preview");
    expect(app?.command).not.toContain("scripts/e2e-build.mjs");
  }
});
