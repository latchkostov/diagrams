import { expect, it, vi } from "vitest";
import { withIsolatedBrowser } from "../../scripts/isolated-smoke-browser";
import { waitForStableEndpoint, withSmokeContainer } from "../../scripts/self-host-container";

const { connect, launch } = vi.hoisted(() => ({ connect: vi.fn(), launch: vi.fn() }));
vi.mock("@playwright/test", () => ({ chromium: { connect, launch } }));
vi.mock("../../scripts/self-host-container", () => ({
  waitForStableEndpoint: vi.fn(),
  withSmokeContainer: vi.fn(async (_run, _image, check) => check({ origin: "http://127.0.0.1:6429" })),
}));

it("isolates Chromium from host Docker interfaces, tunnelling only loopback requests, with the pinned browser", async () => {
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
  expect(connect).toHaveBeenCalledWith({ wsEndpoint: "ws://127.0.0.1:6429", exposeNetwork: "<loopback>" });
  expect(browser.close).toHaveBeenCalledOnce();
  const [, image, , options] = vi.mocked(withSmokeContainer).mock.calls[0];
  const corePackage = Object.keys(options?.mounts ?? {})[0];
  expect(corePackage.replaceAll("\\", "/")).toMatch(/\/playwright-core$/);
  const { version } = await import("@playwright/test/package.json");
  expect(image).toBe(`mcr.microsoft.com/playwright:v${version}-noble`);
  expect(options?.mounts).toEqual({ [corePackage]: "/playwright" });
  expect(options?.command).toEqual(["node", "/playwright/cli.js", "run-server", "--host", "0.0.0.0", "--port", "8080"]);
});
