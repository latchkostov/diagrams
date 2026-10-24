import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { chromium, type Browser } from "@playwright/test";
import { waitForStableEndpoint, withSmokeContainer } from "./self-host-container";
import { duringStartup, type StartupProbe } from "./smoke-startup";

const requireTest = createRequire(import.meta.resolve("@playwright/test/package.json"));
const requirePlaywright = createRequire(requireTest.resolve("playwright/package.json"));
const corePackage = requirePlaywright.resolve("playwright-core/package.json");
const { version } = JSON.parse(readFileSync(corePackage, "utf8")) as { version: string };

const run = (command: string, args: string[], capture = false): string => {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.status !== 0)
    throw new Error(`${command} ${args[0]} failed: ${result.stderr ?? result.error ?? result.status}`);
  return result.stdout;
};

/** Docker bridge churn must not reach Chromium's network-change notifier and abort startup chunks. */
export async function withIsolatedBrowser(
  check: (browser: Browser) => Promise<void>,
  startup?: StartupProbe,
): Promise<void> {
  await withSmokeContainer(
    run,
    `mcr.microsoft.com/playwright:v${version}-noble`,
    async ({ origin }) => {
      await waitForStableEndpoint(origin);
      // Only the browser's loopback requests use the host tunnel. Its network namespace stays fixed
      // while the harness creates/removes deployment networks; every context still starts empty.
      const browser = await duringStartup(
        "browser",
        () =>
          chromium.connect({
            wsEndpoint: origin.replace("http:", "ws:"),
            exposeNetwork: "<loopback>",
            timeout: 30_000,
          }),
        startup,
      );
      try {
        await check(browser);
      } finally {
        await browser.close();
      }
    },
    {
      mounts: { [dirname(corePackage)]: "/playwright" },
      command: ["node", "/playwright/cli.js", "run-server", "--host", "0.0.0.0", "--port", "8080"],
    },
  );
}
