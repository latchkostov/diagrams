import { expect, it } from "vitest";
import { chromiumLaunchArgs, playwrightChromiumArgs } from "../../scripts/e2e-chromium";

it.each(["linux", "darwin"] as const)("retains ordinary Chromium flags on %s", (platform) => {
  expect(chromiumLaunchArgs("127.0.0.1", platform)).toEqual(["--host-resolver-rules=MAP localhost 127.0.0.1"]);
});

it("disables Windows port randomization while preserving every pinned Playwright feature flag", () => {
  const defaults = playwrightChromiumArgs()
    .filter((arg) => arg.startsWith("--disable-features="))
    .flatMap((arg) => arg.slice("--disable-features=".length).split(","));
  // Check the integration is reading real runtime flags, including request interception and storage safeguards.
  expect(defaults).toEqual(
    expect.arrayContaining([
      "BlockOriginHeaderModificationOnRedirect",
      "ThirdPartyStoragePartitioning",
      "PaintHolding",
    ]),
  );
  const args = chromiumLaunchArgs("127.0.0.1", "win32");
  expect(args[0]).toBe("--host-resolver-rules=MAP localhost 127.0.0.1");
  expect(args).toHaveLength(2);
  const features = args[1].slice("--disable-features=".length).split(",");
  expect(features).toEqual([...defaults, "TcpPortRandomizationWin"]);
});
