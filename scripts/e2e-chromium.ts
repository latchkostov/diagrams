import { createRequire } from "node:module";

interface PlaywrightCore {
  server: {
    createPlaywright(options: { sdkLanguage: "javascript" }): {
      chromium: { _innerDefaultArgs(options: object): string[] };
    };
  };
}

/** Read the pinned runtime's flags without launching a browser or copying its feature list. */
export function playwrightChromiumArgs(): string[] {
  const fromHere = createRequire(import.meta.url);
  const fromTest = createRequire(fromHere.resolve("@playwright/test/package.json"));
  const fromPlaywright = createRequire(fromTest.resolve("playwright/package.json"));
  // This is deliberately a small, tested integration with the pinned Playwright internal API.
  // Review/remove it when upgrading Playwright/Chromium: app code must never depend on it.
  const core = fromPlaywright("playwright-core/lib/coreBundle") as PlaywrightCore;
  return core.server.createPlaywright({ sdkLanguage: "javascript" }).chromium._innerDefaultArgs({});
}

export function chromiumLaunchArgs(loopback: string, platform: NodeJS.Platform = process.platform): string[] {
  const args = [`--host-resolver-rules=MAP localhost ${loopback}`];
  if (platform !== "win32") return args;
  // Chromium 156's randomized Windows loopback connects can fail with WSAENOBUFS (10055), before HTTP.
  // A standalone tiny-page probe reproduced it. Disable only this test-browser feature, not error assertions.
  const disabled = playwrightChromiumArgs().filter((arg) => arg.startsWith("--disable-features="));
  if (disabled.length !== 1 || disabled[0] === "--disable-features=")
    throw new Error("Review Windows Chromium launch flags after the Playwright upgrade: expected one feature list");
  // Chrome honors the last switch: a bare new list would re-enable Playwright's other disabled features.
  args.push(`${disabled[0]},TcpPortRandomizationWin`);
  return args;
}
