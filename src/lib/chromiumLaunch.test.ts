import { expect, it } from "vitest";
import { chromiumLaunchArgs, playwrightChromiumArgs } from "../../scripts/e2e-chromium";

it.each(["linux", "darwin"] as const)("retains ordinary Chromium flags for the mDNS diagnostic on %s", (platform) => {
  expect(chromiumLaunchArgs("127.0.0.1", platform, { directHostCandidates: false })).toEqual([
    "--host-resolver-rules=MAP localhost 127.0.0.1",
  ]);
});

it("uses direct host candidates only by default on macOS, preserving the pinned feature flags", () => {
  const disabled = playwrightChromiumArgs().find((arg) => arg.startsWith("--disable-features="));
  expect(chromiumLaunchArgs("127.0.0.1", "darwin")).toEqual([
    "--host-resolver-rules=MAP localhost 127.0.0.1",
    `${disabled},WebRtcHideLocalIpsWithMdns`,
  ]);
  expect(chromiumLaunchArgs("127.0.0.1", "linux")).toEqual(["--host-resolver-rules=MAP localhost 127.0.0.1"]);
});

it("can compare direct candidates with mDNS without re-enabling Windows port randomization", () => {
  const args = chromiumLaunchArgs("127.0.0.1", "win32", { directHostCandidates: true });
  expect(args.at(-1)).toBe(
    `${playwrightChromiumArgs().find((arg) => arg.startsWith("--disable-features="))},TcpPortRandomizationWin,WebRtcHideLocalIpsWithMdns`,
  );
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
