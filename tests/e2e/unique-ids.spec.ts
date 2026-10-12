import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";
import { SLUG, callTool, installFakeModelContext, toolNames } from "./ai-helpers";

// A file that gives a node and a connection one id (tests/fixtures/checks/shared-ids.diagram.json: the Ledger
// service and Billing's flow into the database are both "billing-db"). Edit ops once resolved such an id to the
// node, so removing the connection deleted the Ledger and its connections. Opened, the connection is renamed
// ("billing-db-2") and every edit acts on the kind its target is. data-testid only.

const FIXTURE = readFileSync(new URL("../fixtures/checks/shared-ids.diagram.json", import.meta.url));
const SHARED = "shared-database:billing-db-2";

async function openFixture(page: Page) {
  await page.getByTestId("import-input").setInputFiles({
    name: "shared-ids.diagram.json",
    mimeType: "application/json",
    buffer: FIXTURE,
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Checkout shared ids");
  // The import says so, quietly: the toast it shows anyway names the rename.
  await expect(page.getByTestId("toast")).toContainText('one was renamed to "billing-db-2"');
  await expect(page.getByTestId("node-billing-db")).toBeVisible();
  await expect(page.getByTestId("edge-billing-db-2")).toHaveCount(1);
  await expect(page.getByTestId("edge-ledger-in")).toHaveCount(1);
}

test("a checks fix on a connection that shared a node's id removes the connection, not the node", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, "aks-app-config-key-vault");
  await openFixture(page);
  await page.getByTestId("checks-count").click();
  const row = page.getByTestId(`check-row-${SHARED}`);
  await expect(row).toContainText("Billing uses Order service's database");

  await page.getByTestId(`check-fix-${SHARED}`).click();
  await expect(page.getByTestId("toast")).toContainText("Ask Order service instead: done");
  await expect(row).toHaveCount(0);
  await expect(page.getByTestId("edge-billing-db-2")).toHaveCount(0);
  // The Ledger, which had that id too, and its connection are untouched.
  await expect(page.getByTestId("node-billing-db")).toBeVisible();
  await expect(page.getByTestId("edge-ledger-in")).toHaveCount(1);
  expectNoErrors(consoleErrors);
});

test("WebMCP edit_diagram: removing and updating that connection never touches the node", async ({
  page,
  consoleErrors,
}) => {
  await installFakeModelContext(page);
  await gotoCanvas(page, SLUG);
  await expect.poll(() => toolNames(page)).toContain("edit_diagram");
  await openFixture(page);

  const described = await callTool(page, "describe_diagram", { format: "json" });
  expect(described.isError).toBe(false);
  expect(described.text).toContain("billing-db-2");

  const updated = await callTool(page, "edit_diagram", {
    ops: [{ op: "update", target: "billing-db-2", label: "Totals" }],
  });
  expect(updated.isError).toBe(false);
  expect(JSON.parse(updated.text)).toMatchObject({ ok: true });
  await expect(page.getByTestId("node-billing-db")).toContainText("Ledger");

  const removed = await callTool(page, "edit_diagram", { ops: [{ op: "remove", targets: ["billing-db-2"] }] });
  expect(removed.isError).toBe(false);
  expect(JSON.parse(removed.text)).toMatchObject({ ok: true, results: [{ op: "remove", ids: ["billing-db-2"] }] });
  await expect(page.getByTestId("edge-billing-db-2")).toHaveCount(0);
  await expect(page.getByTestId("node-billing-db")).toBeVisible();
  await expect(page.getByTestId("edge-ledger-in")).toHaveCount(1);
  expectNoErrors(consoleErrors);
});
