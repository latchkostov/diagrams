import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, publicExamples, expectNoErrors } from "./fixtures";

// Infrastructure imports, batch 1: docker-compose (docs/research/imports.md). Open…, drop, the Import report
// and its stencil chips, hostile input, no network, and privacy. Selectors are data-testid only.

const FIXTURES = join(process.cwd(), "tests", "fixtures", "imports");
const COMPOSE = readFileSync(join(FIXTURES, "compose", "docker-compose.yml"), "utf8");
const BOMB = readFileSync(join(FIXTURES, "hostile", "yaml-bomb.yaml"), "utf8");
const SUMMARY = "Imported “shop” from docker-compose: 15 nodes, 17 connections. 2 guesses.";

/** Open… with a fake system picker that returns `files` (the File System Access API, as in Chrome). */
async function fakePicker(page: Page, files: { name: string; text: string }[]) {
  await page.addInitScript((files) => {
    const handle = (f: { name: string; text: string }) => ({
      kind: "file",
      name: f.name,
      getFile: async () => new File([f.text], f.name, { type: "application/yaml" }),
    });
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async (opts: { multiple?: boolean }) => (opts?.multiple ? files : files.slice(0, 1)).map(handle),
    });
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: async () => undefined });
  }, files);
}

async function openViaMenu(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-open").click();
}

async function drop(page: Page, files: { name: string; text: string }[]) {
  const dt = await page.evaluateHandle((files) => {
    const d = new DataTransfer();
    for (const f of files) d.items.add(new File([f.text], f.name, { type: "application/yaml" }));
    return d;
  }, files);
  await page.getByTestId("canvas-view").dispatchEvent("dragenter", { dataTransfer: dt });
  await expect(page.getByTestId("drop-overlay")).toBeVisible();
  await expect(page.getByTestId("drop-overlay")).toContainText("docker-compose");
  await page.getByTestId("drop-overlay").dispatchEvent("drop", { dataTransfer: dt });
  await expect(page.getByTestId("drop-overlay")).toHaveCount(0);
}

async function expectShop(page: Page) {
  await expect(page.getByTestId("diagram-title")).toHaveText("shop");
  for (const id of [
    "gateway",
    "storefront",
    "orders-api",
    "payments-worker",
    "shipping-worker",
    "kafka",
    "schema-registry",
    "postgres",
    "redis",
    "legacy-adapter",
    "users",
    "compose-secrets",
    "topic-orders.placed.v1",
    "topic-payments.completed.v1",
    "ext-api.payments.example.com",
  ])
    await expect(page.getByTestId(`node-${id}`)).toBeVisible();
  await expect(page.getByTestId(/^node-(?!tooltip$|editor-|pips-|pip-|dependencies-|dependency-)/)).toHaveCount(15);
  await expect(page.getByTestId("group-boundary-frontend")).toBeVisible();
  await expect(page.getByTestId("group-boundary-backend")).toBeVisible();
  await expect(page.getByTestId(/^edge-e\d+$/)).toHaveCount(17);
}

test.describe("imports: docker-compose", () => {
  test("Open… imports the compose fixture: nodes, boundaries, connections and the toast", async ({
    page,
    consoleErrors,
  }) => {
    await fakePicker(page, [{ name: "docker-compose.yml", text: COMPOSE }]);
    await gotoCanvas(page, publicExamples[0].slug);
    await openViaMenu(page);
    await expect(page.getByTestId("toast")).toHaveText(new RegExp(SUMMARY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await expect(page.getByTestId("toast-import-details")).toBeVisible();
    await expectShop(page);
    expectNoErrors(consoleErrors);
  });

  test("dropping a compose file and its override imports them as one diagram", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await drop(page, [
      { name: "docker-compose.yml", text: COMPOSE },
      { name: "docker-compose.override.yml", text: "services:\n  mailer:\n    image: axllent/mailpit\n" },
    ]);
    await expect(page.getByTestId("toast")).toContainText("Imported “shop” from docker-compose: 16 nodes");
    await expect(page.getByTestId("node-mailer")).toBeVisible();
    await expect(page.getByTestId("node-topic-orders.placed.v1")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("the report opens from Details, lists the guesses, and a chip fixes one (undoably)", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await drop(page, [{ name: "docker-compose.yml", text: COMPOSE }]);
    await expectShop(page);
    await page.getByTestId("toast-import-details").click();
    const report = page.getByTestId("import-report");
    await expect(report).toBeVisible();
    await expect(page.getByTestId("import-report-summary")).toHaveText(
      "Drew 15 nodes, 17 connections and 2 boundaries.",
    );
    await expect(page.getByTestId("import-report-guesses")).toContainText("Check these guesses (2)");
    await expect(page.getByTestId("import-report-guess-name-0")).toHaveText("storefront");
    await expect(page.getByTestId("import-report-guess-stencil-0")).toHaveText("Node.js Service");
    await expect(page.getByTestId("import-report-guess-name-1")).toHaveText("legacy-adapter");
    await expect(page.getByTestId("import-report-guess-stencil-1")).toHaveText("Service");
    // Connections found in settings name the variable, never its value.
    const settings = page.getByTestId("import-report-settings");
    await expect(settings).toContainText("SPRING_DATASOURCE_URL");
    await expect(settings).toContainText("orders.placed.v1 → payments-worker (reads)");
    await expect(settings).not.toContainText("jdbc:");
    await expect(page.getByTestId("import-report-not-drawn")).toContainText("only in profile “debug”");
    await expect(page.getByTestId("import-report-privacy")).toContainText("Nothing was uploaded.");

    // A chip swaps the stencil; the row shows the new one.
    await page.getByTestId("import-report-chip-1-generic.external-api").click();
    await expect(page.getByTestId("import-report-guess-stencil-1")).toHaveText("External API");
    // "Other…" searches the catalogue.
    await page.getByTestId("import-report-other-0").click();
    await page.getByTestId("import-report-search-0").fill("python");
    await page.getByTestId("import-report-found-0-service.python").click();
    await expect(page.getByTestId("import-report-guess-stencil-0")).toHaveText("Python Service");
    await page.getByTestId("import-report-done").click();
    await expect(report).toHaveCount(0);

    await page.getByTestId("node-legacy-adapter").click();
    await expect(page.getByTestId("inspector-field-stencil")).toContainText("External API");
    // Each swap is one undo step.
    await page.getByTestId("undo-button").click();
    await page.getByTestId("undo-button").click();
    await page.getByTestId("node-legacy-adapter").click();
    await expect(page.getByTestId("inspector-field-stencil")).toContainText("Service");

    // Ctrl+K finds it again while the diagram is open; a row's name selects that node.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await page.getByTestId("command-input").fill("Import report");
    await page.getByTestId("command-input").press("Enter");
    await expect(report).toBeVisible();
    await expect(page.getByTestId("import-report-guess-stencil-1")).toHaveText("Service");
    await page.getByTestId("import-report-guess-name-0").click();
    await expect(report).toHaveCount(0);
    // Both swaps were undone: the import's own guess again.
    await expect(page.getByTestId("inspector-field-stencil")).toContainText("Node.js Service");
    expectNoErrors(consoleErrors);
  });

  test("keyboard: focus stays in the report after an action, and a name hands focus to its node", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await drop(page, [{ name: "docker-compose.yml", text: COMPOSE }]);
    await expectShop(page);
    await page.getByTestId("toast-import-details").click();
    const report = page.getByTestId("import-report");
    await expect(report).toBeVisible();
    // A chip removes itself: the focus moves to the row's Other…, and Esc still closes the report.
    await page.getByTestId("import-report-chip-1-generic.external-api").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("import-report-guess-stencil-1")).toHaveText("External API");
    await expect(page.getByTestId("import-report-other-1")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(report).toHaveCount(0);
    // Make it private removes its button: Done takes the focus.
    await page.keyboard.press("Control+k");
    await page.getByTestId("command-input").fill("Import report");
    await page.getByTestId("command-input").press("Enter");
    await expect(report).toBeVisible();
    await page.getByTestId("import-report-make-private").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("import-report-make-private")).toHaveCount(0);
    await expect(page.getByTestId("import-report-done")).toBeFocused();
    await expect(page.getByTestId("private-badge")).toBeVisible();
    // A name selects its node and, once the report has closed, focuses it.
    await page.getByTestId("import-report-guess-name-0").focus();
    await page.keyboard.press("Enter");
    await expect(report).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-id") ?? null))
      .toBe("storefront");
    expectNoErrors(consoleErrors);
  });

  test("the YAML alias bomb fails fast with a clear message, and nothing is replaced", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const title = await page.getByTestId("diagram-title").textContent();
    await page
      .getByTestId("import-input")
      .setInputFiles({ name: "yaml-bomb.yaml", mimeType: "application/yaml", buffer: Buffer.from(BOMB) });
    const toast = page.getByTestId("toast");
    await expect(toast).toHaveAttribute("data-kind", "error");
    await expect(toast).toHaveText(
      "Couldn't import yaml-bomb.yaml. This file has too many aliases (it could expand to millions of values), so it wasn't read.",
    );
    await expect(page.getByTestId("diagram-title")).toHaveText(title ?? "");
    expectNoErrors(consoleErrors);
  });

  test("an import makes no network requests: nothing leaves the page, nothing is fetched", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const origin = new URL(page.url()).origin;
    const requests: { url: string; type: string }[] = [];
    page.on("request", (r) => requests.push({ url: r.url(), type: r.resourceType() }));
    await drop(page, [
      {
        name: "docker-compose.yml",
        text: `${COMPOSE}\ninclude:\n  - https://example.com/remote-compose.yml\n`,
      },
    ]);
    await expectShop(page);
    // Only the app's own code and icons load (the importer's chunk on first use): no fetch, no XHR, no other host.
    expect(requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith("data:"))).toEqual([]);
    expect(requests.filter((r) => r.type === "fetch" || r.type === "xhr")).toEqual([]);
  });

  test("privacy follows New diagrams are private; the report offers Make it private", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    // Off (the default): not private, and the report's foot offers it.
    await drop(page, [{ name: "docker-compose.yml", text: COMPOSE }]);
    await expectShop(page);
    await expect(page.getByTestId("private-badge")).toHaveCount(0);
    await page.getByTestId("toast-import-details").click();
    await page.getByTestId("import-report-make-private").click();
    await expect(page.getByTestId("import-report-privacy")).not.toContainText("isn't private");
    await page.getByTestId("import-report-done").click();
    await expect(page.getByTestId("private-badge")).toBeVisible();

    // On: the next import is private from the start, and the report doesn't ask.
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-privacy").click();
    await page.getByTestId("privacy-new-diagrams").click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await drop(page, [{ name: "docker-compose.yml", text: COMPOSE.replace("name: shop", "name: shop-two") }]);
    await expect(page.getByTestId("diagram-title")).toHaveText("shop-two");
    await expect(page.getByTestId("private-badge")).toBeVisible();
    await page.getByTestId("toast-import-details").click();
    await expect(page.getByTestId("import-report-privacy")).toHaveText("Read on this device. Nothing was uploaded.");
    await expect(page.getByTestId("import-report-make-private")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("the compose import is overlap-free in the Lab's audit", async ({ page }) => {
    await page.goto("./?view=lab&preset=overlap-audit&diagram=imported-compose");
    const summary = page.getByTestId("audit-summary");
    await expect(summary).toBeVisible();
    for (const kind of ["label-node", "label-label", "node-node"])
      await expect(page.getByTestId(`audit-count-${kind}`)).toHaveAttribute("data-count", "0");
  });
});

// ---------------------------------------------------------------- AsyncAPI (batch 2)

const ASYNCAPI = (name: string) => ({
  name,
  text: readFileSync(join(FIXTURES, "asyncapi", name), "utf8"),
});
const ORDERS = ASYNCAPI("orders-service.asyncapi.yaml");
const SHIPPING = ASYNCAPI("shipping-service.asyncapi.yaml");
const NOTIFICATIONS = ASYNCAPI("notifications-2.6.asyncapi.yaml");

interface SavedDiagram {
  title: string;
  nodes: { id: string; stencil: string }[];
  edges: { from: string; to: string; props?: Record<string, unknown> }[];
  simulations?: { id: string }[];
}

/** The imported diagram as stored in Your diagrams (data, not a selector: the canvas shows the same). */
async function stored(page: Page, title: string): Promise<SavedDiagram> {
  let found: SavedDiagram | undefined;
  await expect
    .poll(async () => {
      found = await page.evaluate((title) => {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i) ?? "";
          if (!key.startsWith("diagrams.doc.v1:")) continue;
          try {
            const d = JSON.parse(localStorage.getItem(key) ?? "null");
            const doc = d?.doc ?? d?.diagram ?? d;
            if (doc?.title === title) return doc;
          } catch {
            // not a diagram
          }
        }
        return undefined;
      }, title);
      return !!found;
    })
    .toBe(true);
  if (!found) throw new Error(`No stored diagram “${title}”`);
  return found;
}
const has = (d: SavedDiagram, from: string, to: string) => d.edges.some((e) => e.from === from && e.to === to);

test.describe("imports: AsyncAPI", () => {
  test("two 3.0 documents join on their channel: producer, topic, consumer and the Schema Registry", async ({
    page,
    consoleErrors,
  }) => {
    await fakePicker(page, [ORDERS, SHIPPING]);
    await gotoCanvas(page, publicExamples[0].slug);
    await openViaMenu(page);
    await expect(page.getByTestId("toast")).toContainText("Imported “2 services” from AsyncAPI");
    await expect(page.getByTestId("diagram-title")).toHaveText("2 services");
    for (const id of ["order-service", "shipping-service", "topic-orders.placed.v1", "schema-registry.shop.internal"])
      await expect(page.getByTestId(`node-${id}`)).toBeVisible();
    // One joined topic, not one per file.
    await expect(page.getByTestId("node-topic-orders.placed.v1-2")).toHaveCount(0);
    await expect(page.getByTestId("group-boundary-kafka-kafka-0.shop.internal-9092")).toBeVisible();
    const d = await stored(page, "2 services");
    expect(has(d, "order-service", "topic-orders.placed.v1")).toBe(true);
    expect(has(d, "topic-orders.placed.v1", "shipping-service")).toBe(true);
    expect(has(d, "order-service", "schema-registry.shop.internal")).toBe(true);
    expect(has(d, "shipping-service", "schema-registry.shop.internal")).toBe(true);
    // The report says where traffic starts.
    await page.getByTestId("toast-import-details").click();
    await expect(page.getByTestId("import-report-traffic-0")).toContainText("Order service");
    await expect(page.getByTestId("import-report-traffic-0")).toContainText("1 msg/s for 2 min");
    expectNoErrors(consoleErrors);
  });

  test("Go live with Imported traffic: messages flow", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await drop(page, [ORDERS, SHIPPING, NOTIFICATIONS]);
    await expect(page.getByTestId("diagram-title")).toHaveText("3 services");
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await page.getByTestId("live-sim-picker").selectOption("imported-traffic");
    await expect(page.getByTestId("live-sim-picker")).toHaveValue("imported-traffic");
    await expect
      .poll(async () => Number(await page.getByTestId("live-canvas").getAttribute("data-particles")), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    expectNoErrors(consoleErrors);
  });

  test("AsyncAPI 2.6: publish means it receives, subscribe means it sends", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await drop(page, [NOTIFICATIONS]);
    await expect(page.getByTestId("diagram-title")).toHaveText("Notification service");
    const d = await stored(page, "Notification service");
    expect(has(d, "topic-order-notifications", "notification-service")).toBe(true);
    expect(has(d, "notification-service", "topic-order-notifications")).toBe(false);
    expect(has(d, "notification-service", "topic-email.sent")).toBe(true);
    expect(has(d, "topic-email.sent", "notification-service")).toBe(false);
    expectNoErrors(consoleErrors);
  });

  test("a remote $ref is never fetched, and the import says why nothing could be drawn", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const origin = new URL(page.url()).origin;
    const requests: { url: string; type: string }[] = [];
    page.on("request", (r) => requests.push({ url: r.url(), type: r.resourceType() }));
    const title = await page.getByTestId("diagram-title").textContent();
    await page.getByTestId("import-input").setInputFiles({
      name: "recursive-ref.asyncapi.yaml",
      mimeType: "application/yaml",
      buffer: readFileSync(join(FIXTURES, "hostile", "recursive-ref.asyncapi.yaml")),
    });
    const toast = page.getByTestId("toast");
    await expect(toast).toHaveAttribute("data-kind", "error");
    await expect(toast).toHaveText(
      "Couldn't import recursive-ref.asyncapi.yaml. Nothing in it could be drawn: $ref https://schemas.example.com/remote.yaml#/components/messages/Remote (a remote reference, never fetched: open that file too).",
    );
    await expect(page.getByTestId("diagram-title")).toHaveText(title ?? "");
    expect(requests.filter((r) => r.url.includes("schemas.example.com"))).toEqual([]);
    expect(requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith("data:"))).toEqual([]);
  });

  test("an AsyncAPI import makes no network requests", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const origin = new URL(page.url()).origin;
    const requests: { url: string; type: string }[] = [];
    page.on("request", (r) => requests.push({ url: r.url(), type: r.resourceType() }));
    await drop(page, [ORDERS, SHIPPING, NOTIFICATIONS]);
    await expect(page.getByTestId("node-notification-service")).toBeVisible();
    expect(requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith("data:"))).toEqual([]);
    expect(requests.filter((r) => r.type === "fetch" || r.type === "xhr")).toEqual([]);
  });

  test("the AsyncAPI import is overlap-free in the Lab's audit", async ({ page }) => {
    await page.goto("./?view=lab&preset=overlap-audit&diagram=imported-asyncapi");
    await expect(page.getByTestId("audit-summary")).toBeVisible();
    for (const kind of ["label-node", "label-label", "node-node"])
      await expect(page.getByTestId(`audit-count-${kind}`)).toHaveAttribute("data-count", "0");
  });
});
