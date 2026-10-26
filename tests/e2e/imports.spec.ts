import { openDiagramProperties } from "./fixtures";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  publicExamples,
  expectNoErrors,
  openShareChooser,
  waitForStableViewport,
} from "./fixtures";

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
    await page.keyboard.press("ControlOrMeta+k");
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
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("command-input").fill("Import report");
    await page.getByTestId("command-input").press("Enter");
    await expect(report).toBeVisible();
    await page.getByTestId("import-report-make-private").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("import-report-make-private")).toHaveCount(0);
    await expect(page.getByTestId("import-report-done")).toBeFocused();
    await openDiagramProperties(page);
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
    await openDiagramProperties(page);
    await expect(page.getByTestId("private-badge")).toBeVisible();

    // On: the next import is private from the start, and the report doesn't ask.
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-privacy").click();
    await page.getByTestId("privacy-new-diagrams").click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await drop(page, [{ name: "docker-compose.yml", text: COMPOSE.replace("name: shop", "name: shop-two") }]);
    await expect(page.getByTestId("diagram-title")).toHaveText("shop-two");
    await openDiagramProperties(page);
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

  test("Go live with Imported traffic: messages reach Shipping and Notification", async ({ page, consoleErrors }) => {
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
    // Not just moving: delivered through the joined topics to both downstream consumers.
    for (const id of ["shipping-service", "notification-service"])
      await expect
        .poll(async () => Number(await page.getByTestId(`node-badge-${id}`).getAttribute("data-processed")), {
          timeout: 20_000,
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

// ---------------------------------------------------------------- Kubernetes (batch 3)

const K8S_DIR = join(FIXTURES, "k8s");
const K8S = ["00-namespaces.yaml", "data.yaml", "ingress.yaml", "orders-api.yaml", "payments-worker.yaml"].map(
  (name) => ({ name, text: readFileSync(join(K8S_DIR, name), "utf8") }),
);
const K8S_SUMMARY = "Imported “shop and kafka” from Kubernetes: 14 nodes, 13 connections.";

interface StoredK8s {
  nodes: { id: string; group?: string }[];
  edges: { from: string; to: string; relation?: string; kind?: string; props?: Record<string, unknown> }[];
  groups?: { id: string; label: string }[];
}

async function expectK8s(page: Page) {
  await expect(page.getByTestId("diagram-title")).toHaveText("shop and kafka");
  for (const id of [
    "orders-api",
    "payments-worker",
    "settlement-report",
    "postgres",
    "redis",
    "storefront",
    "ingress-shop",
    "users",
    "topic-orders.placed.v1",
    "topic-payments.completed.v1",
    "configmap-orders-api-config",
    "secret-orders-db",
    "secret-payment-provider",
    "identity-orders-api",
  ])
    await expect(page.getByTestId(`node-${id}`)).toBeVisible();
  await expect(page.getByTestId(/^node-(?!tooltip$|editor-|pips-|pip-|dependencies-|dependency-)/)).toHaveCount(14);
  // One boundary per namespace.
  await expect(page.getByTestId("group-boundary-shop")).toBeVisible();
  await expect(page.getByTestId("group-boundary-kafka")).toBeVisible();
  await expect(page.getByTestId(/^edge-e\d+$/)).toHaveCount(13);
}

test.describe("imports: Kubernetes", () => {
  test("Open… imports the manifest set: namespaces, the Ingress entry, config, secrets and the KEDA consumer", async ({
    page,
    consoleErrors,
  }) => {
    await fakePicker(page, K8S);
    await gotoCanvas(page, publicExamples[0].slug);
    await openViaMenu(page);
    await expect(page.getByTestId("toast")).toContainText(K8S_SUMMARY);
    await expectK8s(page);
    const d = (await stored(page, "shop and kafka")) as unknown as StoredK8s;
    const groupOf = (id: string) => d.groups?.find((g) => g.id === d.nodes.find((n) => n.id === id)?.group)?.label;
    for (const id of ["orders-api", "payments-worker", "postgres", "ingress-shop", "configmap-orders-api-config"])
      expect(groupOf(id), id).toBe("shop");
    for (const id of ["topic-orders.placed.v1", "topic-payments.completed.v1"]) expect(groupOf(id), id).toBe("kafka");
    const e = (from: string, to: string) => d.edges.find((x) => x.from === from && x.to === to);
    // The Ingress is the entry: Users → Ingress → the workloads behind its Services.
    expect(e("users", "ingress-shop")?.kind).toBe("sync");
    expect(e("ingress-shop", "orders-api")?.kind).toBe("sync");
    expect(e("ingress-shop", "storefront")?.kind).toBe("sync");
    // Config and secret relationships, named by keys only.
    expect(e("orders-api", "configmap-orders-api-config")?.relation).toBe("config");
    expect(e("orders-api", "secret-orders-db")?.relation).toBe("secret");
    expect(e("payments-worker", "secret-payment-provider")?.relation).toBe("secret");
    expect(e("orders-api", "identity-orders-api")?.relation).toBe("identity");
    // KEDA: the Kafka topic → its consumer, with the consumer group.
    expect(e("topic-orders.placed.v1", "payments-worker")).toMatchObject({
      kind: "async",
      props: { group: "payments" },
    });
    expect(JSON.stringify(d)).not.toContain("cGxhY2Vob2xkZXI");
    expectNoErrors(consoleErrors);
  });

  test("dropping the set imports it, and the report lists settings, what wasn't drawn and the KEDA range", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const dt = await page.evaluateHandle((files) => {
      const d = new DataTransfer();
      for (const f of files) d.items.add(new File([f.text], f.name, { type: "application/yaml" }));
      return d;
    }, K8S);
    await page.getByTestId("canvas-view").dispatchEvent("dragenter", { dataTransfer: dt });
    await expect(page.getByTestId("drop-overlay")).toContainText("Kubernetes");
    await page.getByTestId("drop-overlay").dispatchEvent("drop", { dataTransfer: dt });
    await expect(page.getByTestId("toast")).toContainText(K8S_SUMMARY);
    await expectK8s(page);
    await page.getByTestId("toast-import-details").click();
    await expect(page.getByTestId("import-report")).toBeVisible();
    await expect(page.getByTestId("import-report-summary")).toHaveText(
      "Drew 14 nodes, 13 connections and 2 boundaries.",
    );
    const settings = page.getByTestId("import-report-settings");
    await expect(settings).toContainText("DATABASE_HOST");
    await expect(settings).toContainText("REDIS_URL");
    await expect(settings).toContainText("ORDERS_TOPIC");
    await expect(settings).not.toContainText("redis://");
    await expect(page.getByTestId("import-report-not-drawn-0")).toContainText("Kafka shop-kafka");
    await expect(page.getByTestId("import-report-not-drawn-0")).toContainText("shown through its topics");
    await expect(page.getByTestId("import-report-not-drawn-1")).toContainText("ServiceMonitor orders-api");
    await expect(page.getByTestId("import-report-not-drawn-1")).toContainText("unknown kind (monitoring.coreos.com)");
    await expect(page.getByTestId("import-report-note").filter({ hasText: "payments-worker scales" })).toHaveText(
      "payments-worker scales from 1 to 12 replicas (KEDA).",
    );
    await expect(page.getByTestId("import-report-guesses")).toHaveCount(0);
    await expect(page.getByTestId("import-report")).not.toContainText("cGxhY2Vob2xkZXI");
    await page.getByTestId("import-report-done").click();
    expectNoErrors(consoleErrors);
  });

  test("a Helm template says to run helm template, and nothing is replaced", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const title = await page.getByTestId("diagram-title").textContent();
    await page.getByTestId("import-input").setInputFiles({
      name: "deployment.yaml",
      mimeType: "application/yaml",
      buffer: Buffer.from("apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ .Values.name }}\n"),
    });
    const toast = page.getByTestId("toast");
    await expect(toast).toHaveAttribute("data-kind", "error");
    await expect(toast).toHaveText(
      "Couldn't import deployment.yaml. This looks like a Helm template ({{ .Values… }}). Run “helm template” and import its output.",
    );
    await expect(page.getByTestId("diagram-title")).toHaveText(title ?? "");
    expectNoErrors(consoleErrors);
  });

  test("a Kubernetes import makes no network requests", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const origin = new URL(page.url()).origin;
    const requests: { url: string; type: string }[] = [];
    page.on("request", (r) => requests.push({ url: r.url(), type: r.resourceType() }));
    await drop(page, K8S);
    await expectK8s(page);
    expect(requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith("data:"))).toEqual([]);
    expect(requests.filter((r) => r.type === "fetch" || r.type === "xhr")).toEqual([]);
  });

  test("the Kubernetes import is overlap-free in the Lab's audit", async ({ page }) => {
    await page.goto("./?view=lab&preset=overlap-audit&diagram=imported-kubernetes");
    await expect(page.getByTestId("audit-summary")).toBeVisible();
    for (const kind of ["label-node", "label-label", "node-node"])
      await expect(page.getByTestId(`audit-count-${kind}`)).toHaveAttribute("data-count", "0");
  });
});

// ---------------------------------------------------------------- Terraform (batch 4)

const TF_DIR = join(FIXTURES, "terraform");
const TF_AWS = { name: "aws-plan.json", text: readFileSync(join(TF_DIR, "aws-plan.json"), "utf8") };
const TF_SUMMARY = "Imported “aws-plan” from Terraform plan: 13 nodes, 16 connections.";
/** Values in the plan that must never reach the page or the stored diagram. */
const TF_SECRETS = [
  "sk_live",
  "hunter2",
  "Rnd-pa55word",
  "ssm-secure-value",
  "hook-token",
  "abc123signature",
  "123456789012",
];

interface StoredTf {
  nodes: { id: string; group?: string; stencil: string }[];
  edges: { from: string; to: string; relation?: string; kind?: string; props?: Record<string, unknown> }[];
  groups?: { id: string; label: string }[];
}

async function expectAwsPlan(page: Page) {
  await expect(page.getByTestId("diagram-title")).toHaveText("aws-plan");
  for (const id of [
    "order-events",
    "orders-queue",
    "orders-dlq",
    "order-handler",
    "orders",
    "orders-projector",
    "order-handler-role",
    "orders-db-credentials",
    "orders-projector-config",
    "events-msk",
    "analytics",
    "nightly-rollup",
    "ext-audit.example.com",
  ])
    await expect(page.getByTestId(`node-${id}`)).toBeVisible();
  await expect(page.getByTestId(/^node-(?!tooltip$|editor-|pips-|pip-|dependencies-|dependency-)/)).toHaveCount(13);
  await expect(page.getByTestId("group-boundary-module.streaming")).toBeVisible();
  await expect(page.getByTestId(/^edge-e\d+$/)).toHaveCount(16);
}

test.describe("imports: Terraform", () => {
  test("Open… imports the AWS plan: flows from subscriptions and mappings, the module boundary, IAM and secrets", async ({
    page,
    consoleErrors,
  }) => {
    await fakePicker(page, [TF_AWS]);
    await gotoCanvas(page, publicExamples[0].slug);
    await openViaMenu(page);
    await expect(page.getByTestId("toast")).toContainText(TF_SUMMARY);
    await expectAwsPlan(page);
    const d = (await stored(page, "aws-plan")) as unknown as StoredTf;
    const e = (from: string, to: string) => d.edges.find((x) => x.from === from && x.to === to);
    // SNS → SQS → Lambda: a subscription and an event-source mapping are message flows.
    expect(e("order-events", "orders-queue")?.kind).toBe("async");
    expect(e("orders-queue", "order-handler")?.kind).toBe("async");
    expect(e("orders", "orders-projector")?.kind).toBe("async");
    expect(e("events-msk", "analytics")).toMatchObject({ kind: "async", props: { group: "orders-analytics" } });
    // References: the role is Identity, the secret Secret, the parameter Config, the table Depends on.
    expect(e("order-handler", "order-handler-role")?.relation).toBe("identity");
    expect(e("order-handler", "orders-db-credentials")?.relation).toBe("secret");
    expect(e("orders-projector", "orders-projector-config")?.relation).toBe("config");
    expect(e("order-handler", "orders")?.relation).toBe("depends");
    // module.streaming is a boundary holding MSK and its consumers.
    const groupOf = (id: string) => d.groups?.find((g) => g.id === d.nodes.find((n) => n.id === id)?.group)?.label;
    expect(groupOf("events-msk")).toBe("module.streaming");
    expect(groupOf("analytics")).toBe("module.streaming");
    expect(groupOf("order-handler")).toBeUndefined();
    const json = JSON.stringify(d);
    for (const secret of TF_SECRETS) expect(json, secret).not.toContain(secret);
    expectNoErrors(consoleErrors);
  });

  test("dropping the plan imports it; the report lists connections, what isn't drawn, and draws everything", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const dt = await page.evaluateHandle((f) => {
      const d = new DataTransfer();
      d.items.add(new File([f.text], f.name, { type: "application/json" }));
      return d;
    }, TF_AWS);
    await page.getByTestId("canvas-view").dispatchEvent("dragenter", { dataTransfer: dt });
    await expect(page.getByTestId("drop-overlay")).toContainText("Terraform plan");
    await page.getByTestId("drop-overlay").dispatchEvent("drop", { dataTransfer: dt });
    await expect(page.getByTestId("toast")).toContainText(TF_SUMMARY);
    await expectAwsPlan(page);
    await page.getByTestId("toast-import-details").click();
    const report = page.getByTestId("import-report");
    await expect(report).toBeVisible();
    await expect(page.getByTestId("import-report-summary")).toHaveText("Drew 13 nodes, 16 connections and 1 boundary.");
    // The connections say which resource made them.
    const connections = page.getByTestId("import-report-settings");
    await expect(connections).toContainText("Connections from subscriptions, mappings and grants");
    await expect(connections).toContainText("aws_sns_topic_subscription.orders_queue");
    await expect(connections).toContainText("aws_lambda_event_source_mapping.orders_queue");
    await expect(connections).toContainText("aws_iam_role_policy.order_handler");
    // The plan's changes and the supporting-resources summary.
    const notes = page.getByTestId("import-report-note");
    await expect(notes.nth(0)).toHaveText("Plan: 28 to add, 0 to change, 1 to destroy.");
    await expect(notes.nth(1)).toHaveText(
      "7 supporting resources aren't drawn: access and permissions, parts of what's drawn, monitoring, networking and helpers.",
    );
    const notDrawn = page.getByTestId("import-report-not-drawn");
    await expect(notDrawn).toContainText("aws_iam_role_policy_attachment basic_logs");
    await expect(notDrawn).toContainText("aws_sqs_queue legacy_orders");
    await expect(notDrawn).toContainText("destroyed by this plan");
    await expect(page.getByTestId("import-report-guesses")).toHaveCount(0);
    for (const secret of TF_SECRETS) await expect(report).not.toContainText(secret);
    // Draw everything: the same plan again, every resource a node, as a new diagram.
    await page.getByTestId("import-report-draw-everything").click();
    await expect(page.getByTestId("import-report")).toHaveCount(0);
    await expect(page.getByTestId("diagram-title")).toHaveText("aws-plan (everything)");
    await expect(page.getByTestId(/^node-(?!tooltip$|editor-|pips-|pip-|dependencies-|dependency-)/)).toHaveCount(27);
    await expect(page.getByTestId("node-msk-brokers")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("Draw everything keeps a manually private import private, and hands the focus to the new canvas", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    // New diagrams are private is off (the default): the import isn't private until the person says so.
    await drop(page, [TF_AWS]);
    await expectAwsPlan(page);
    await expect(page.getByTestId("private-badge")).toHaveCount(0);
    await page.getByTestId("toast-import-details").click();
    await page.getByTestId("import-report-make-private").click();
    await expect(page.getByTestId("import-report-privacy")).not.toContainText("isn't private");
    // Keyboard: the link is activated from the keyboard, and the focus lands on the new diagram's canvas.
    await page.getByTestId("import-report-draw-everything").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("diagram-title")).toHaveText("aws-plan (everything)");
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
    await openDiagramProperties(page);
    await expect(page.getByTestId("private-badge")).toBeVisible();
    // Still private after a reload: no share link for it.
    await page.reload();
    await expect(page.getByTestId("diagram-title")).toHaveText("aws-plan (everything)");
    await openDiagramProperties(page);
    await expect(page.getByTestId("private-badge")).toBeVisible();
    await openShareChooser(page);
    await expect(page.getByTestId("share-private-note")).toBeVisible();
    await expect(page.getByTestId("share-public-toggle")).toHaveCount(0);
    await page.keyboard.press("Escape");
    expectNoErrors(consoleErrors);
  });

  test("Terraform source (.tf) says to run terraform show -json, and nothing is replaced", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const title = await page.getByTestId("diagram-title").textContent();
    await page.getByTestId("import-input").setInputFiles({
      name: "main.tf",
      mimeType: "text/plain",
      buffer: Buffer.from('resource "aws_sqs_queue" "orders" {\n  name = "orders"\n}\n'),
    });
    const toast = page.getByTestId("toast");
    await expect(toast).toHaveAttribute("data-kind", "error");
    await expect(toast).toHaveText(
      "Couldn't import main.tf. Terraform source (.tf) isn't read. Run “terraform show -json plan.out” (or state) and import that.",
    );
    await expect(page.getByTestId("diagram-title")).toHaveText(title ?? "");
    expectNoErrors(consoleErrors);
  });

  test("a Terraform import makes no network requests", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const origin = new URL(page.url()).origin;
    const requests: { url: string; type: string }[] = [];
    page.on("request", (r) => requests.push({ url: r.url(), type: r.resourceType() }));
    await drop(page, [TF_AWS]);
    await expectAwsPlan(page);
    // The plan names audit.example.com and AWS endpoints: none of them is contacted.
    expect(requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith("data:"))).toEqual([]);
    expect(requests.filter((r) => r.type === "fetch" || r.type === "xhr")).toEqual([]);
  });

  for (const theme of ["light", "dark"] as const)
    test(`a long module address wraps between its parts and copies whole (1280, ${theme})`, async ({
      page,
      consoleErrors,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.emulateMedia({ colorScheme: theme });
      await gotoCanvas(page, publicExamples[0].slug);
      await drop(page, [TF_AWS]);
      await expectAwsPlan(page);
      await page.getByTestId("toast-import-details").click();
      const address = "module.streaming.aws_lambda_event_source_mapping.analytics";
      const evidence = page.getByTestId(/^import-report-setting-evidence-\d+$/).filter({ hasText: address });
      await expect(evidence).toHaveCount(1);
      await expect(evidence).toHaveText(address);
      // Each rendered line, from where its characters sit.
      const lines = await evidence.evaluate((el) => {
        const out: string[] = [];
        let top: number | undefined;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode())
          for (let i = 0; i < (n.textContent ?? "").length; i++) {
            const r = document.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + 1);
            const t = Math.round(r.getBoundingClientRect().top);
            if (top === undefined || Math.abs(t - top) > 2) out.push("");
            top = t;
            out[out.length - 1] += (n.textContent ?? "")[i];
          }
        return out;
      });
      expect(lines.join("")).toBe(address);
      expect(lines.length, lines.join(" | ")).toBeGreaterThan(1);
      // Never inside a name: every line but the last ends at a "." (or the next starts with "[").
      for (let i = 0; i < lines.length - 1; i++)
        expect(/[./]$/.test(lines[i]) || lines[i + 1].startsWith("["), lines.join(" | ")).toBe(true);
      // Selected, it copies as one string: the break opportunities add no text.
      const copied = await evidence.evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const sel = getSelection();
        if (!sel) return "";
        sel.removeAllRanges();
        sel.addRange(r);
        return sel.toString();
      });
      expect(copied).toBe(address);
      expectNoErrors(consoleErrors);
    });

  test("Draw everything is compact: fitted, its cards are readable, not specks in a tall column", async ({
    page,
    consoleErrors,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoCanvas(page, publicExamples[0].slug);
    await drop(page, [TF_AWS]);
    await expectAwsPlan(page);
    await page.getByTestId("toast-import-details").click();
    await page.getByTestId("import-report-draw-everything").click();
    await expect(page.getByTestId("diagram-title")).toHaveText("aws-plan (everything)");
    await page.getByTestId("fit-view-button").click();
    // Measured once Fit's animation has finished, not part-way through it.
    await waitForStableViewport(page);
    // The whole diagram fits the view at a scale where a card reads: the spread layout fitted at under a fifth.
    const card = await page.getByTestId("node-msk-brokers").boundingBox();
    const view = await page.getByTestId("canvas-view").boundingBox();
    expect(card?.width ?? 0).toBeGreaterThan(110);
    // And the card is in the fitted view.
    expect(card && view).toBeTruthy();
    if (card && view) {
      expect(card.x).toBeGreaterThanOrEqual(view.x);
      expect(card.y).toBeGreaterThanOrEqual(view.y);
      expect(card.x + card.width).toBeLessThanOrEqual(view.x + view.width);
      expect(card.y + card.height).toBeLessThanOrEqual(view.y + view.height);
    }
    // And the drawing uses the view's width, not a narrow strip down the middle.
    const d = (await stored(page, "aws-plan (everything)")) as unknown as { nodes: { x: number; y: number }[] };
    const xs = d.nodes.map((n) => n.x);
    const ys = d.nodes.map((n) => n.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(Math.max(...xs) - Math.min(...xs));
    expectNoErrors(consoleErrors);
  });

  for (const diagram of ["imported-terraform", "imported-terraform-azure"])
    test(`the Terraform import is overlap-free in the Lab's audit (${diagram})`, async ({ page }) => {
      await page.goto(`./?view=lab&preset=overlap-audit&diagram=${diagram}`);
      await expect(page.getByTestId("audit-summary")).toBeVisible();
      for (const kind of ["label-node", "label-label", "node-node"])
        await expect(page.getByTestId(`audit-count-${kind}`)).toHaveAttribute("data-count", "0");
    });
});

/**
 * A cluster too big to draw at once: `namespaces` of `size` Deployments, the first four calling along a chain (the
 * most flows first). Generated here, so the fixture is plainly public.
 */
function bigCluster(namespaces = 40, size = 10): string {
  const docs: string[] = [];
  for (let n = 0; n < namespaces; n++) {
    const ns = `team-${String(n).padStart(2, "0")}`;
    const calls = n < 4 ? size - 1 - n : 0;
    for (let w = 0; w < size; w++)
      docs.push(`apiVersion: apps/v1
kind: Deployment
metadata: { name: w${w}-api, namespace: ${ns} }
spec:
  selector: { matchLabels: { app: w${w}-api } }
  template:
    metadata: { labels: { app: w${w}-api } }
    spec:
      containers:
        - name: w${w}-api
          image: example/w${w}
          env: [${w < calls ? `{ name: NEXT_URL, value: "http://w${w + 1}-api:8080" }` : ""}]
---
apiVersion: v1
kind: Service
metadata: { name: w${w}-api, namespace: ${ns} }
spec: { selector: { app: w${w}-api } }`);
  }
  return docs.join("\n---\n");
}

test.describe("imports: big imports", () => {
  test("a big import draws the boundaries with the most flows; the report picks others as a new diagram", async ({
    page,
    consoleErrors,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoCanvas(page, publicExamples[0].slug);
    await drop(page, [{ name: "cluster.yaml", text: bigCluster() }]);
    // 400 workloads in 40 namespaces: 30 namespaces fit in 300 nodes, the four with flows first.
    await expect(page.getByTestId("toast")).toContainText("300 of 400 nodes");
    const title = (await page.getByTestId("diagram-title").textContent()) ?? "";
    await expect(page.getByTestId("group-boundary-team-00")).toBeVisible();
    await expect(page.getByTestId("group-boundary-team-39")).toHaveCount(0);
    await page.getByTestId("toast-import-details").click();
    const pick = page.getByTestId("import-report-pick");
    await expect(pick).toBeVisible();
    await expect(pick).toContainText("Boundaries (30 of 40 selected)");
    await expect(page.getByTestId("import-report-pick-lede")).toContainText("It has 400 nodes");
    // The most flows first, each row with its nodes and flows; the drawn ones ticked.
    await expect(page.getByTestId("import-report-pick-row-0")).toContainText("team-00");
    await expect(page.getByTestId("import-report-pick-row-0")).toContainText("10 nodes · 9 flows");
    await expect(page.getByTestId("import-report-pick-0")).toBeChecked();
    await expect(page.getByTestId("import-report-pick-39")).not.toBeChecked();
    // Nothing changed yet: nothing to draw, and the status (announced politely) says why.
    const draw = page.getByTestId("import-report-pick-draw");
    const status = page.getByTestId("import-report-pick-status");
    await expect(draw).toBeDisabled();
    await expect(draw).toHaveText("Draw these (300 nodes)");
    await expect(status).toHaveAttribute("role", "status");
    await expect(status).toHaveText("300 nodes ticked: these are drawn.");
    // Unavailable, not disabled: it stays in the Tab order, described by the status, as each checkbox is.
    const describedBy = await draw.getAttribute("aria-describedby");
    expect(describedBy).toBe(await status.getAttribute("id"));
    await expect(page.getByTestId("import-report-pick-0")).toHaveAttribute("aria-describedby", describedBy ?? "");
    await draw.focus();
    await expect(draw).toBeFocused();
    // Swap one: untick team-00 (keyboard), tick the last one.
    await page.getByTestId("import-report-pick-0").focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("import-report-pick-0")).not.toBeChecked();
    await expect(status).toHaveText("290 nodes ticked.");
    await page.getByTestId("import-report-pick-39").check();
    await expect(draw).toBeEnabled();
    await expect(draw).toHaveText("Draw these (300 nodes)");
    await expect(status).toHaveText("300 nodes ticked.");
    await draw.click();
    await expect(page.getByTestId("import-report")).toHaveCount(0);
    await expect(page.getByTestId("toast")).toContainText("300 of 400 nodes");
    await expect(page.getByTestId("group-boundary-team-39")).toBeVisible();
    await expect(page.getByTestId("group-boundary-team-00")).toHaveCount(0);
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
    // A new diagram: the first one is still there, as it was.
    const all = await page.evaluate(() => {
      const titles: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) ?? "";
        if (!key.startsWith("diagrams.doc.v1:")) continue;
        const d = JSON.parse(localStorage.getItem(key) ?? "null");
        titles.push((d?.doc ?? d?.diagram ?? d)?.title);
      }
      return titles;
    });
    expect(all.filter((t) => t === title)).toHaveLength(1);
    // Named by what it draws, so the two aren't taken for each other.
    await expect(page.getByTestId("diagram-title")).toHaveText(`${title} (team-01, team-02 and 28 more)`);
    // The new one's report keeps the picker, with its own boundaries ticked.
    await page.getByTestId("toast-import-details").click();
    await expect(page.getByTestId("import-report-pick-39")).toBeChecked();
    await expect(page.getByTestId("import-report-pick-0")).not.toBeChecked();
    expectNoErrors(consoleErrors);
  });
});
