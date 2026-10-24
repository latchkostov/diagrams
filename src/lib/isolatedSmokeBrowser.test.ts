import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { withSmokeBrowser } from "../../scripts/self-host-browser";
import { withIsolatedBrowser } from "../../scripts/isolated-smoke-browser";
import { waitForStableEndpoint, withSmokeContainer } from "../../scripts/self-host-container";

const { connect, launch, run } = vi.hoisted(() => ({ connect: vi.fn(), launch: vi.fn(), run: vi.fn() }));
vi.mock("@playwright/test", () => ({ chromium: { connect, launch } }));
vi.mock("../../scripts/self-host-container", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../scripts/self-host-container")>();
  return {
    ...actual,
    waitForStableEndpoint: vi.fn(),
    withSmokeContainer: vi.fn(async (_run, image, check, options) =>
      actual.withSmokeContainer(run, image, check, options),
    ),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function dockerRun() {
  run.mockImplementation((_command: string, args: string[]) =>
    args[0] === "create" ? "a".repeat(64) : args[0] === "port" ? "127.0.0.1:6429" : "",
  );
}

it("isolates Chromium from host Docker interfaces, tunnelling only loopback requests, with the pinned browser", async () => {
  dockerRun();
  const browser = { close: vi.fn() };
  launch.mockResolvedValue(browser);
  connect.mockImplementation(async () => {
    expect(waitForStableEndpoint).toHaveBeenCalledWith("http://127.0.0.1:6429");
    return browser;
  });
  const failure = new Error("boot failed");
  await expect(
    withIsolatedBrowser(async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(launch).not.toHaveBeenCalled();
  expect(connect).toHaveBeenCalledWith({
    wsEndpoint: "ws://127.0.0.1:6429",
    exposeNetwork: "<loopback>",
    timeout: 30_000,
  });
  expect(browser.close).toHaveBeenCalledOnce();
  const [, image, , options] = vi.mocked(withSmokeContainer).mock.calls[0];
  const corePackage = Object.keys(options?.mounts ?? {})[0];
  expect(corePackage.replaceAll("\\", "/")).toMatch(/\/playwright-core$/);
  const { version } = await import("@playwright/test/package.json");
  expect(image).toBe(`mcr.microsoft.com/playwright:v${version}-noble`);
  expect(options?.mounts).toEqual({ [corePackage]: "/playwright" });
  expect(options?.command).toEqual(["node", "/playwright/cli.js", "run-server", "--host", "0.0.0.0", "--port", "8080"]);
});

it("removes the owned Docker container after renderer diagnostics never respond", async () => {
  vi.useFakeTimers();
  dockerRun();
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  const evaluate = vi.fn(() => new Promise(() => {}));
  const browser = {
    contexts: () => [{ pages: () => [{ url: () => "about:blank", evaluate }] }],
    close: vi.fn(async () => {}),
  };
  connect.mockResolvedValue(browser);
  const failure = new Error("boot failed");
  const result = withSmokeBrowser(async () => {
    throw failure;
  });
  const rejected = expect(result).rejects.toBe(failure);
  await vi.waitFor(() => expect(evaluate).toHaveBeenCalledOnce());
  await vi.runAllTimersAsync();
  await rejected;
  expect(output.mock.calls.flat().join("\n")).toContain("Browser diagnostics deadline exceeded");
  expect(browser.close).toHaveBeenCalledOnce();
  expect(run).toHaveBeenLastCalledWith("docker", ["rm", "-f", "a".repeat(64)]);
  expect(vi.getTimerCount()).toBe(0);
});

it("wires network churn to both real startup boundaries before using the context", async () => {
  dockerRun();
  const context = Object.assign(new EventEmitter(), {
    addInitScript: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  });
  const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => {}) };
  connect.mockResolvedValue(browser);
  const phases: string[] = [];
  await withSmokeBrowser(
    async (newContext) => {
      expect(await newContext()).toBe(context);
      expect(phases).toEqual(["browser", "context"]);
    },
    async (phase) => {
      phases.push(phase);
    },
  );
  expect(browser.close).toHaveBeenCalledOnce();
  expect(run).toHaveBeenLastCalledWith("docker", ["rm", "-f", "a".repeat(64)]);
});
