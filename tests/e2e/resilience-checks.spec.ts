import { test, expect, gotoCanvas, savedDiagram, openCheckFinding } from "./fixtures";
import { callTool, installFakeModelContext, toolNames } from "./ai-helpers";
import { waitForBackgroundChecks } from "./checks-readiness";
import storm from "../../src/examples/retry-storm.json" with { type: "json" };

async function openChecks(page: import("@playwright/test").Page) {
  await gotoCanvas(page, "retry-storm");
  await waitForBackgroundChecks(page);
  await page.getByTestId("checks-count").click();
  await expect(page.getByTestId("checks-card")).toBeVisible();
}

test("the worker offers one proven recovery policy with evidence, applied and undone as one edit", async ({ page }) => {
  await openChecks(page);
  await openCheckFinding(page, "retry-storm:pay");
  const row = page.getByTestId("check-row-retry-storm:pay"),
    fix = page.getByTestId("check-fix-retry-storm:pay");
  await expect(row).toContainText("successful work after clearing rises");
  await expect(row).toContainText("deadline-based queue limit");
  await expect(page.getByTestId("check-row-retry-budget:pay")).toHaveCount(0);
  await expect(page.getByTestId("check-fix-option-0-retry-storm:pay")).toHaveCount(0);
  await expect(fix).toHaveText("Apply proven recovery policy");
  const before = storm;
  await fix.focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await savedDiagram(page)).nodes.find((n) => n.id === "payments")?.props?.queue)
    .toMatchObject({ order: "lifo", maxWaitMs: 200 });
  await expect
    .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "pay")?.props?.caller)
    .toMatchObject({ breaker: {}, retry: { jitter: 1, budget: { percent: 20 } } });
  await expect(row).toHaveCount(0);
  await page.getByTestId("check-fix-undo").click();
  await expect
    .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "pay")?.props)
    .toEqual(before.edges.find((e) => e.id === "pay")?.props);
  await expect
    .poll(async () => (await savedDiagram(page)).nodes.find((n) => n.id === "payments")?.props)
    .toEqual(before.nodes.find((n) => n.id === "payments")?.props);
  await openCheckFinding(page, "retry-storm:pay");
  await expect(fix).toBeEnabled();
});

test("unsafe retry alternatives remain ordinary undoable static fixes", async ({ page }) => {
  await openChecks(page);
  await openCheckFinding(page, "retry-idempotency:pay");
  const option = page.getByTestId("check-fix-option-0-retry-idempotency:pay");
  await expect(option).toBeEnabled();
  await option.click();
  await expect
    .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "pay")?.props?.caller)
    .toMatchObject({ retry: { idempotent: true } });
  await expect(page.getByTestId("check-row-retry-idempotency:pay")).toHaveCount(0);
  await page.getByTestId("check-fix-undo").click();
  await openCheckFinding(page, "retry-idempotency:pay");
  await expect(option).toBeEnabled();
});

test("a translated static option and its completion toast fit the 1024 px Checks card", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.addInitScript(() => localStorage.setItem("diagrams.locale", "en-XA"));
  await openChecks(page);
  await openCheckFinding(page, "retry-idempotency:pay");
  const option = page.getByTestId("check-fix-option-0-retry-idempotency:pay");
  await expect(option).toBeEnabled();
  const label = await option.innerText();
  expect(label).toContain("[");
  const box = await page.getByTestId("checks-card").boundingBox();
  if (!box) throw new Error("Checks card must have a visible box");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1024);
  await option.click();
  await expect(page.getByTestId("toast")).toContainText(label);
  await expect(page.getByTestId("check-fix-undo")).not.toHaveText("Undo");
});

test("agents await the same worker proof and describe the executed resilience and queue policy", async ({ page }) => {
  await installFakeModelContext(page);
  await gotoCanvas(page, "retry-storm");
  await expect.poll(() => toolNames(page)).toContain("check_diagram");
  const checked = await callTool(page, "check_diagram", { rules: ["retry-storm"] });
  expect(checked.isError).toBe(false);
  const report = JSON.parse(checked.text);
  expect(report.findings[0].resilienceFinding).toMatchObject({
    kind: "retry-storm",
    probe: { slowdown: 5 },
    replay: { step: "shedding" },
  });
  expect(report.findings[0].fix.ops).toHaveLength(2);
  expect(report.findings[0].fix.others).toBeUndefined();
  const described = await callTool(page, "describe_diagram", { format: "json" });
  const diagram = JSON.parse(described.text);
  expect(diagram.edges.find((e: { id: string }) => e.id === "pay").resilience).toMatchObject({
    attempts: 3,
    idempotent: false,
    amplification: { worst: 3 },
  });
  expect(diagram.nodes.find((n: { id: string }) => n.id === "payments").queue).toMatchObject({
    limit: null,
    order: "fifo",
  });
});
