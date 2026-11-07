import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, expect, gotoCanvas, savedDiagram, openCheckFinding } from "./fixtures";
import { waitForBackgroundChecks } from "./checks-readiness";
import { callTool, installFakeModelContext, toolNames } from "./ai-helpers";
import small from "../../src/examples/cache-stampede.json" with { type: "json" };

async function openChecks(page: import("@playwright/test").Page) {
  await gotoCanvas(page, "cache-stampede");
  await waitForBackgroundChecks(page);
  await page.getByTestId("checks-count").click();
  await expect(page.getByTestId("checks-card")).toBeVisible();
}
async function screenshot(page: import("@playwright/test").Page, name: string) {
  if (!process.env.CDN6_SHOTS) return;
  mkdirSync(process.env.CDN6_SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.CDN6_SHOTS, `${name}.png`) });
}

test("Checks and agents share the cold probe, a proven fix, its alternative and one-step undo", async ({ page }) => {
  await installFakeModelContext(page);
  await openChecks(page);
  await openCheckFinding(page, "cache-stampede:cdn:launch");
  const row = page.getByTestId("check-row-cache-stampede:cdn:launch");
  await expect(row).toContainText("Cold cache probe");
  await expect(page.getByTestId("check-fix-cache-stampede:cdn:launch")).toHaveText("One fetch per item");
  const other = page.getByTestId("check-fix-option-0-cache-stampede:cdn:launch");
  await expect(other).toHaveText("Serve stale while refreshing");
  await screenshot(page, "cache-checks");
  await expect.poll(() => toolNames(page)).toContain("check_diagram");
  const report = await callTool(page, "check_diagram", { rules: ["cache-stampede"] });
  expect(report.isError).toBe(false);
  expect(JSON.parse(report.text).findings[0].cacheFinding).toMatchObject({
    kind: "cache-stampede",
    node: "cdn",
    rule: "launch",
    probe: { kind: "cold-cache" },
  });
  const before = small.nodes.find((n) => n.id === "cdn")?.props?.cache;
  await other.focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await savedDiagram(page)).nodes.find((n) => n.id === "cdn")?.props?.cache)
    .toMatchObject({
      rules: [{ policy: { coalesce: true, staleWhileRevalidateMs: expect.any(Number) } }, { id: "products" }],
    });
  await expect(row).toHaveCount(0);
  await page.getByTestId("check-fix-undo").click();
  await expect
    .poll(async () => (await savedDiagram(page)).nodes.find((n) => n.id === "cdn")?.props?.cache)
    .toEqual(before);
});

test("Arabic cache Checks isolate authored names and fit the compact card", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.addInitScript(() => localStorage.setItem("diagrams.locale", "ar"));
  await openChecks(page);
  await openCheckFinding(page, "cache-cold-start:cdn:launch");
  const row = page.getByTestId("check-row-cache-cold-start:cdn:launch");
  await expect(row).toContainText("\u2068Product API\u2069");
  await expect(page.getByTestId("check-fix-cache-cold-start:cdn:launch")).toContainText("إضافة");
  const box = await page.getByTestId("checks-card").boundingBox();
  if (!box) throw new Error("Checks must have a visible box");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1024);
  await screenshot(page, "cache-checks-arabic");
});

test("agents describe cache expectations and author a purge Drill", async ({ page }) => {
  await installFakeModelContext(page);
  await gotoCanvas(page, "cache-stampede");
  await expect.poll(() => toolNames(page)).toContain("describe_diagram");
  const described = await callTool(page, "describe_diagram", { format: "json" });
  const node = JSON.parse(described.text).nodes.find((n: { id: string }) => n.id === "cdn");
  expect(node.capabilities).toContain("cache");
  expect(node.cache.rules[0].expected).toMatchObject({
    requestsPerSec: 320,
    herd: expect.any(Number),
    offload: expect.any(Number),
  });
  const result = await callTool(page, "set_simulation", {
    title: "Cold cache check",
    durationSec: 20,
    traffic: [],
    events: [{ do: "purge", atSec: 5, node: "Edge CDN", mode: "soft", reason: "deploy" }],
  });
  expect(result.isError).toBe(false);
  await expect
    .poll(
      async () =>
        (await savedDiagram(page)).simulations?.find((s) => s.title === "Cold cache check")?.timeline?.[0].action,
    )
    .toMatchObject({
      do: "fault",
      fault: { kind: "purge", node: "cdn", mode: "soft", reason: "deploy" },
      drill: "cold-cache",
    });
});
