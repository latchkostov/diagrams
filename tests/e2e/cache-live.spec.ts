import { test, expect, gotoLive, pauseClock, STORAGE_KEYS, openLiveNodeDetails } from "./fixtures";
import { cacheFixture } from "../../src/lab/cacheFixture";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test("Live shows the hit chip, cache hover, split latency and Inputs derivation", async ({ page }) => {
  const d = cacheFixture();
  d.nodes[1].props = {
    ...d.nodes[1].props,
    cache: {
      rules: [
        { id: "pages", label: "Pages", match: { types: ["*"] }, policy: { ttlMs: 1000, keys: 20, popularity: "even" } },
      ],
    },
  };
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    diagram: d,
  });
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(3000);
  const chip = page.getByTestId("node-cache-cache");
  await expect(chip).toContainText("% hits");
  await expect(chip).toHaveAttribute("aria-label", /cacheable requests answered from the cache/);
  await page.getByTestId("live-play").click();
  await page.clock.resume();
  await openLiveNodeDetails(page, "cache", "cache");

  await expect(page.getByTestId("cache-readout")).toContainText("Recent window (up to 10 s)");
  await expect(page.getByTestId("cache-latency")).toContainText("Misses p95");
  await expect(page.getByTestId("cache-live-rule-pages")).toContainText("hits since restart (expected 86%)");
  if (process.env.CDN_SHOTS) {
    mkdirSync(process.env.CDN_SHOTS, { recursive: true });
    await chip.screenshot({ path: join(process.env.CDN_SHOTS, "chip.png") });
    await page.getByTestId("node-detail-cache").screenshot({ path: join(process.env.CDN_SHOTS, "hover.png") });
  }
  await page.keyboard.press("Escape");
  await page.getByTestId("live-capacity").click();
  await expect(page.getByTestId("cache-derivation-cache-pages")).toHaveText(
    "Pages: 200 requests/s, kept 1 s, over 20 items (Even) → 86% hits. 28/s reach Origin.",
  );
  await page.getByTestId("capacity-rate-source").fill("40");
  await page.getByTestId("capacity-rate-source").press("Enter");
  await expect(page.getByTestId("cache-derivation-cache-pages")).toHaveText(
    "Pages: 40 requests/s, kept 1 s, over 20 items (Even) → 64% hits. 14/s reach Origin.",
  );
});
