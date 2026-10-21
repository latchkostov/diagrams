import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect, pauseClock } from "./fixtures";
import type { FakeState } from "../../integrations/confluence-forge/test/fake-bridge";
import { textFieldsFixture } from "../../src/lab/textFieldsFixture";

// Independent header, matching the existing viewer-bundle Forge CSP tests.
const FORGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src blob:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'";
let server: Server;
let origin: string;
// Repetitions run in separate workers. Each builds into its own test-only directory.
test.describe.configure({ mode: "default" });

test.beforeAll(() => {
  test.setTimeout(120_000);
  for (const args of [["--fake"], []])
    execFileSync(process.execPath, ["integrations/confluence-forge/build.mjs", ...args], {
      cwd: resolve("."),
      stdio: "pipe",
      env: { ...process.env, FORGE_TEST_WORKER: String(process.pid) },
    });
  const files = new Map<string, Buffer>();
  for (const [prefix, directory] of [
    ["fake", `tests/.output/confluence-forge-${process.pid}/fake`],
    ["real", `tests/.output/confluence-forge-${process.pid}/real`],
  ]) {
    for (const name of readdirSync(directory, { recursive: true }).map(String)) {
      if (/\.(html|js|css|woff2|svg)$/.test(name))
        files.set(`/${prefix}/${name.replaceAll("\\", "/")}`, readFileSync(join(directory, name)));
    }
  }
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://forge").pathname;
    if (path === "/host.html") {
      response.writeHead(200, {
        "Content-Type": "text/html",
        "Content-Security-Policy": "default-src 'none'; frame-src 'self'; style-src 'unsafe-inline'",
      });
      response.end(
        '<!doctype html><html><body style="margin:0"><iframe data-testid="forge-frame" src="/fake/view/index.html" style="display:block;width:100%;border:0;height:150px"></iframe></body></html>',
      );
      return;
    }
    const content = files.get(path);
    const extension = path.split(".").pop();
    const types: Record<string, string> = {
      js: "text/javascript",
      css: "text/css",
      html: "text/html",
      svg: "image/svg+xml",
      woff2: "font/woff2",
    };
    response.writeHead(content ? 200 : 404, {
      "Content-Type": types[extension ?? ""] ?? "application/octet-stream",
      "Content-Security-Policy": FORGE_CSP,
    });
    response.end(content);
  });
  return new Promise<void>((done) =>
    server.listen(0, "127.0.0.1", () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      done();
    }),
  );
});
test.afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((done) => server.close(() => done()));
});

async function setup(page: import("@playwright/test").Page, overrides: Partial<FakeState> = {}) {
  await page.addInitScript((value) => {
    window.__forgeTest = { calls: [], ...value };
    const parse = JSON.parse;
    JSON.parse = function (text, reviver) {
      if (window.__forgeTest.body && typeof text === "string" && text.startsWith('{"format":"diagrams/'))
        window.__forgeTest.parseCount = (window.__forgeTest.parseCount ?? 0) + 1;
      return parse(text, reviver);
    };
  }, overrides);
}

for (const saved of [false, true]) {
  test(`Forge viewer: still until keyboard Play, ${saved ? "saved simulation" : "Free play"}, theme and no egress`, async ({
    page,
  }) => {
    const violations: string[] = [];
    const requests: string[] = [];
    const errors: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.exposeFunction("forgeCsp", (directive: string) => violations.push(directive));
    await page.addInitScript(() =>
      document.addEventListener("securitypolicyviolation", (e) =>
        (window as unknown as { forgeCsp(s: string): void }).forgeCsp(e.effectiveDirective),
      ),
    );
    await page.clock.install();
    await setup(page, {
      config: { attachmentId: "7", simulation: saved ? "flow" : "", height: saved ? 600 : 0, theme: "auto" },
    });
    await page.goto(`${origin}/fake/view/index.html`);
    await expect(page.getByTestId("node-a")).toBeVisible();
    await expect(page.getByTestId("viewer-bundle")).toHaveAttribute("data-live", "0");
    await expect(page.getByTestId("forge-play")).toHaveAccessibleName("Play diagram");
    await pauseClock(page);
    await page.clock.runFor(10_000);
    await expect(page.getByTestId("viewer-bundle")).toHaveAttribute("data-live", "0");
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
    await page.evaluate(() => {
      document.documentElement.dataset.colorMode = "light";
    });
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
    if (saved)
      expect(await page.getByTestId("viewer-bundle").evaluate((el) => el.getBoundingClientRect().height)).toBe(600);
    await page.getByTestId("forge-play").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
    await expect(page.getByTestId("live-sim-picker")).toHaveValue(saved ? "flow" : "");
    expect(await page.evaluate(() => [...document.links].map((a) => a.href))).toEqual([]);
    expect(requests.every((url) => url.startsWith(origin + "/"))).toBe(true);
    expect(await page.evaluate(() => window.__forgeTest.calls)).toEqual([
      { path: "/wiki/api/v2/attachments/7", method: "GET" },
      { path: "/wiki/rest/api/content/42/child/attachment/7/download?version=3", method: "GET" },
    ]);
    expect(violations).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("Forge reader sees an honest permission error, never a fallback copy or a Play button", async ({ page }) => {
  await setup(page, { status: 403 });
  await page.goto(`${origin}/fake/view/index.html`);
  await expect(page.getByTestId("forge-status")).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("forge-status")).toContainText("could not be downloaded (403)");
  await expect(page.getByTestId("forge-play")).toHaveCount(0);
  await expect(page.getByTestId("node-a")).toHaveCount(0);
});

test("Forge future files fail honestly", async ({ page }) => {
  await setup(page, { body: '{"format":"diagrams/v99"}' });
  await page.goto(`${origin}/fake/view/index.html`);
  await expect(page.getByTestId("forge-status")).toContainText("update the app");
  await expect(page.getByTestId("forge-play")).toHaveCount(0);
});

test("deployable resource runs the real bridge SDK under Forge CSP with an offline product transport", async ({
  page,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  const violations: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.exposeFunction("forgeRealCsp", (directive: string) => violations.push(directive));
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) =>
      (window as unknown as { forgeRealCsp(s: string): void }).forgeRealCsp(event.effectiveDirective),
    ),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((diagram) => {
    const calls: string[] = [];
    Object.assign(globalThis, {
      __forgeSdkCalls: calls,
      __bridge: {
        callBridge: async (method: string, payload?: { restPath?: string }) => {
          calls.push(method);
          if (method === "openModal") Object.assign(window, { __forgeSdkModal: payload });
          if (method === "getContext") return { extension: { content: { id: "42" }, config: { attachmentId: "7" } } };
          if (method === "enableTheming") {
            document.documentElement.dataset.colorMode = "dark";
            return;
          }
          if (method === "fetchProduct")
            return {
              body: payload?.restPath?.includes("/wiki/api/v2/attachments/")
                ? JSON.stringify({
                    id: "7",
                    pageId: "42",
                    fileSize: new TextEncoder().encode(diagram).byteLength,
                    version: { number: 3 },
                  })
                : diagram,
              headers: { "content-type": "application/json" },
              statusText: "OK",
              status: 200,
            };
        },
      },
    });
  }, JSON.stringify(textFieldsFixture));
  await page.goto(`${origin}/real/view/index.html`);
  await expect(page.getByTestId("node-a")).toBeVisible();
  await page.getByTestId("forge-play").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  await page.getByTestId("forge-maximise").click();
  expect(await page.evaluate(() => (window as unknown as { __forgeSdkModal: unknown }).__forgeSdkModal)).toMatchObject({
    resource: "diagram-view",
    size: "max",
    closeOnEscape: true,
    context: { pageId: "42", config: { attachmentId: "7", simulation: "", height: 0, theme: "auto" } },
  });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __forgeSdkCalls: string[] }).__forgeSdkCalls)).toEqual([
    "getContext",
    "enableTheming",
    "fetchProduct",
    "fetchProduct",
    "openModal",
  ]);
  expect(violations).toEqual([]);
  expect(requests.every((url) => url.startsWith(origin + "/"))).toBe(true);
});

test("Forge oversized metadata shows the size error without downloading", async ({ page }) => {
  await setup(page, { fileSize: 8_000_001 });
  await page.goto(`${origin}/fake/view/index.html`);
  await expect(page.getByTestId("forge-status")).toContainText("8 MB");
  expect(await page.evaluate(() => window.__forgeTest.calls)).toEqual([
    { path: "/wiki/api/v2/attachments/7", method: "GET" },
  ]);
  await expect(page.getByTestId("forge-play")).toHaveCount(0);
});

test("Forge host theme changes update React Flow, live particle colours and caption contrast during playback", async ({
  page,
}) => {
  const body = JSON.stringify({
    ...textFieldsFixture,
    nodes: textFieldsFixture.nodes.map((node) =>
      node.id === "a" ? { ...node, props: { ratePerSec: 10, jitter: 0 } } : node,
    ),
    edges: [{ ...textFieldsFixture.edges[0], props: { travelMs: 1000 } }],
    annotations: [
      { id: "caption", kind: "text", text: "Theme contrast", color: "#222222", x: 400, y: 300, width: 200, height: 80 },
    ],
  });
  await page.clock.install();
  await setup(page, { body });
  await page.addInitScript(() => {
    const values: { offset: number; color: string }[] = [];
    Object.assign(window, { forgeGradients: values, forgeParses: 0 });
    const add = CanvasGradient.prototype.addColorStop;
    CanvasGradient.prototype.addColorStop = function (offset, color) {
      values.push({ offset, color });
      return add.call(this, offset, color);
    };
  });
  await page.goto(`${origin}/fake/view/index.html`);
  await expect(page.getByTestId("node-a")).toBeVisible();

  await page.getByTestId("forge-play").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  await pauseClock(page);
  for (const theme of ["light", "dark", "light"] as const) {
    await page.evaluate((theme) => {
      (window as unknown as { forgeGradients: unknown[] }).forgeGradients.length = 0;
      document.documentElement.dataset.colorMode = theme;
    }, theme);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    await page.clock.runFor(1200);
    await expect(page.getByTestId("rf__wrapper")).toHaveClass(new RegExp(`(?:^| )${theme}(?: |$)`));
    await expect(page.getByTestId("canvas-wrap")).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(14, 19, 29)" : "rgb(243, 245, 248)",
    );
    await expect(page.getByTestId("annotation-text-caption")).toHaveCSS(
      "color",
      theme === "dark" ? "rgb(232, 236, 244)" : "rgb(34, 34, 34)",
    );
    const gradients = await page.evaluate(
      () => (window as unknown as { forgeGradients: { offset: number; color: string }[] }).forgeGradients,
    );
    const alpha = theme === "dark" ? 0.7 * 0.8 : 0.4 * 0.8;
    expect(gradients.some(({ offset, color }) => offset === 0 && color.endsWith(`,${alpha})`))).toBe(true);
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  }
});

test("Forge viewer validates attachment JSON once at the adapter boundary", async ({ page }) => {
  await setup(page, { body: JSON.stringify(textFieldsFixture) });
  await page.goto(`${origin}/fake/view/index.html`);
  await expect(page.getByTestId("node-a")).toBeVisible();
  expect(await page.evaluate(() => window.__forgeTest.parseCount)).toBe(1);
});

test("Forge maximise opens the same resource with references only and recovers focus on close", async ({ page }) => {
  await setup(page, { config: { attachmentId: "7", simulation: "flow", height: 600, theme: "light" } });
  await page.goto(`${origin}/fake/view/index.html`);
  await expect(page.getByTestId("node-a")).toBeVisible();
  await page.getByTestId("forge-maximise").click();
  await expect
    .poll(() => page.evaluate(() => window.__forgeTest.modalOptions))
    .toEqual({
      resource: "diagram-view",
      size: "max",
      closeOnEscape: true,
      context: { pageId: "42", config: { attachmentId: "7", simulation: "flow", height: 600, theme: "light" } },
    });
  await expect(page.getByTestId("forge-maximise")).toBeDisabled();
  await page.evaluate(() => window.__forgeTest.closeModal?.());
  await expect(page.getByTestId("forge-maximise")).toBeFocused();
  await expect(page.getByTestId("forge-maximise")).toBeEnabled();
  await expect(page.getByTestId("present-fullscreen")).toHaveCount(0);
  await expect(page.getByTestId(/download|open-app|open-in/)).toHaveCount(0);
});

for (const key of [true, false]) {
  test(`Forge max modal fills its viewport, stays still and closes by ${key ? "Esc" : "button"}`, async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1100 });
    await setup(page, {
      config: { attachmentId: "8", simulation: "", height: 200, theme: "dark" },
      pageId: "99",
      modal: { pageId: "42", config: { attachmentId: "7", simulation: "flow", height: 200, theme: "light" } },
    });
    await page.goto(`${origin}/fake/view/index.html`);
    await expect(page.getByTestId("node-a")).toBeVisible();
    await expect(page.getByTestId("viewer-bundle")).toHaveAttribute("data-live", "0");
    const box = await page.getByTestId("viewer-bundle").boundingBox();
    if (!box) throw new Error("Modal viewer has no box");
    expect(box.height).toBeGreaterThan(900);
    expect(box.y + box.height).toBe(1100);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(1100);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
    expect(await page.evaluate(() => window.__forgeTest.calls)).toEqual([
      { path: "/wiki/api/v2/attachments/7", method: "GET" },
      { path: "/wiki/rest/api/content/42/child/attachment/7/download?version=3", method: "GET" },
    ]);
    await expect(page.getByTestId("forge-maximise")).toHaveCount(0);
    await expect(page.getByTestId("present-fullscreen")).toHaveCount(0);
    await page.getByTestId("forge-play").click();
    await expect(page.getByTestId("live-sim-picker")).toHaveValue("flow");
    if (key) await page.keyboard.press("Escape");
    else await page.getByTestId("forge-close").click();
    await expect.poll(() => page.evaluate(() => window.__forgeTest.closed)).toBe(true);
  });
}

test("Forge reports a failed modal open and allows retry", async ({ page }) => {
  await setup(page, { modalError: true });
  await page.goto(`${origin}/fake/view/index.html`);
  await page.getByTestId("forge-maximise").click();
  await expect(page.getByTestId("forge-status")).toHaveText("Confluence could not maximise the diagram. Try again.");
  await expect(page.getByTestId("forge-maximise")).toBeEnabled();
  await page.evaluate(() => {
    window.__forgeTest.modalError = false;
  });
  await page.getByTestId("forge-maximise").click();
  await expect.poll(() => page.evaluate(() => window.__forgeTest.modalOptions?.size)).toBe("max");
});

test("Forge Automatic follows column width and resizes the host iframe without feedback", async ({ page }) => {
  const body = JSON.stringify({
    ...textFieldsFixture,
    nodes: textFieldsFixture.nodes.map((node, i) => ({ ...node, x: i * 350, y: i * 350 })),
  });
  await page.setViewportSize({ width: 320, height: 1200 });
  await setup(page, { body });
  await page.goto(`${origin}/host.html`);
  const frame = page.frameLocator('[data-testid="forge-frame"]');
  await expect(frame.getByTestId("node-a")).toBeVisible();
  await expect(frame.getByTestId("viewer-bundle")).toHaveCSS("height", "480px");
  const iframe = page.getByTestId("forge-frame");
  await expect.poll(async () => (await iframe.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(480);
  const initial = await iframe.boundingBox();
  if (!initial) throw new Error("Host iframe has no box");
  expect(initial.height).toBeGreaterThanOrEqual(480);
  await page.setViewportSize({ width: 800, height: 1200 });
  await expect
    .poll(() => frame.getByTestId("viewer-bundle").evaluate((el) => el.getBoundingClientRect().height))
    .toBeGreaterThan(480);
  const medium = await frame.getByTestId("viewer-bundle").evaluate((el) => el.getBoundingClientRect().height);
  expect(medium).toBeLessThan(900);
  await page.setViewportSize({ width: 1600, height: 1200 });
  await expect(frame.getByTestId("viewer-bundle")).toHaveCSS("height", "900px");
  await expect
    .poll(() =>
      iframe.evaluate((el) => {
        const doc = (el as HTMLIFrameElement).contentDocument;
        if (!doc) throw new Error("Host iframe has no document");
        return doc.body.getBoundingClientRect().height;
      }),
    )
    .toBeGreaterThanOrEqual(900);
  await expect.poll(() => iframe.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(900);
  // Repeated size reports must not mutate the content or start another host resize cycle.
  const counts = await iframe.evaluate(async (el) => {
    const win = (el as HTMLIFrameElement).contentWindow as Window;
    const root = win.document.querySelector<HTMLElement>('[data-testid="viewer-bundle"]')?.parentElement;
    if (!root) throw new Error("Viewer has no root");
    let writes = 0;
    const observer = new MutationObserver((records) => {
      writes += records.length;
    });
    observer.observe(root, { attributes: true, attributeFilter: ["style"] });
    for (let i = 0; i < 8; i++) {
      win.liveDiagramsViewer.report({ type: "resize", height: 1600 });
      await new Promise(win.requestAnimationFrame);
    }
    observer.disconnect();
    return { writes, heights: win.__forgeTest.documentHeights };
  });
  expect(counts.writes).toBe(0);
  if (!counts.heights) throw new Error("Host did not observe any document sizes");
  expect(counts.heights.length).toBeLessThan(24);
  const final = await iframe.boundingBox();
  if (!final) throw new Error("Host iframe has no final box");
  expect(counts.heights.at(-1)).toBe(final.height);
});
const chosenDiagram = JSON.stringify({
  ...textFieldsFixture,
  simulations: [{ id: "spike", title: "Black Friday spike", durationMs: 60_000, traffic: [] }],
});
const validFile = (name = "checkout.diagram.json", body = chosenDiagram) => ({
  name,
  mimeType: "application/json",
  buffer: Buffer.from(body),
});
const writes = (page: import("@playwright/test").Page) =>
  page.evaluate(() => ({
    uploads: window.__forgeTest.calls.filter((call) => call.method === "POST"),
    saves: window.__forgeTest.submitCount ?? 0,
  }));
async function openConfig(
  page: import("@playwright/test").Page,
  config: Record<string, unknown> = {},
  extra: Partial<FakeState> = {},
) {
  await setup(page, { config, ...extra });
  await page.goto(`${origin}/fake/config/index.html`);
  await expect(page.getByTestId("forge-fields")).toBeEnabled();
}
async function chooseFile(page: import("@playwright/test").Page, name?: string, body?: string) {
  await page.getByTestId("forge-file").setInputFiles(validFile(name, body));
  await expect(page.getByTestId("forge-card")).toBeFocused();
  await expect(page.getByTestId("forge-save")).toBeEnabled();
}

test("Forge empty state explains disabled Insert and keyboard Choose stages without writes", async ({ page }) => {
  await openConfig(page);
  await expect(page.getByTestId("forge-title")).toHaveText("Live Diagram");
  await expect(page.getByTestId("forge-save")).toHaveText("Insert");
  await expect(page.getByTestId("forge-save")).toBeDisabled();
  await expect(page.getByTestId("forge-save")).toHaveAccessibleDescription("Choose a diagram file to continue");
  await expect(page.getByTestId("forge-file-hint")).toHaveText("Saved from Live Diagrams (File ▸ Save diagram file)");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("forge-choose")).toBeFocused();
  for (const key of ["Enter", "Space"]) {
    const picker = page.waitForEvent("filechooser");
    await page.keyboard.press(key);
    await (await picker).setFiles(validFile());
    await expect(page.getByTestId("forge-card")).toBeFocused();
    await expect(page.getByTestId("forge-preview")).toHaveAttribute("data-nodes", "3");
    await expect(page.getByTestId("forge-preview")).toHaveAccessibleName("Preview of Fields");
    expect(await page.getByTestId("forge-preview").textContent()).toBe("");
    await expect(page.getByTestId("forge-options-panel")).toBeHidden();
    await expect(page.getByTestId("forge-summary")).toHaveText("Free play · Auto size");
    if (key === "Enter") await page.getByTestId("forge-change").focus();
  }
  expect(await writes(page)).toEqual({ uploads: [], saves: 0 });
  await page.getByTestId("forge-cancel").click();
  await expect.poll(() => page.evaluate(() => window.__forgeTest.closed)).toBe(true);
  expect(await writes(page)).toEqual({ uploads: [], saves: 0 });
});

for (const [name, id, path] of [
  ["checkout.diagram.json", "9", ""],
  ["orders.diagram.json", "7", "/7/data"],
  ["older.livediagram.json", "10", "/10/data"],
] as const) {
  test(`Forge Insert commits ${name} once, versioning a same-name attachment`, async ({ page }) => {
    await openConfig(page);
    await chooseFile(page, name);
    expect(await writes(page)).toEqual({ uploads: [], saves: 0 });
    await page.evaluate(() => {
      window.__forgeTest.hold = "upload";
    });
    await page.getByTestId("forge-save").click();
    await expect(page.getByTestId("forge-save")).toHaveText("Inserting…");
    await expect(page.getByTestId("forge-save")).toBeDisabled();
    await expect(page.getByTestId("forge-cancel")).toBeDisabled();
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.__forgeTest.closed)).toBeUndefined();
    await expect.poll(() => page.evaluate(() => !!window.__forgeTest.release)).toBe(true);
    await page.evaluate(() => window.__forgeTest.release?.());
    await expect
      .poll(() => page.evaluate(() => window.__forgeTest.submitted))
      .toEqual({ config: { attachmentId: id, simulation: "", height: 0, theme: "auto" } });
    expect(await writes(page)).toEqual({
      uploads: [{ path: `/wiki/rest/api/content/42/child/attachment${path}`, method: "POST", filename: name }],
      saves: 1,
    });
    const uploaded = await page.evaluate(() => window.__forgeTest.uploaded);
    await page.addInitScript(
      ({ id, uploaded }) => {
        window.__forgeTest = { calls: [], config: { attachmentId: id }, uploaded };
      },
      { id, uploaded },
    );
    await page.goto(`${origin}/fake/view/index.html`);
    await expect(page.getByTestId("node-a")).toContainText("Order service");
  });
}

for (const [name, buffer, message] of [
  ["bad.diagram.json", Buffer.from("{"), "not a valid Live Diagrams file"],
  ["bad.diagram.json", Buffer.from("{}"), "not a valid Live Diagrams file"],
  ["diagram.json", Buffer.from(chosenDiagram), "Choose a .diagram.json file"],
  ["big.diagram.json", Buffer.alloc(8_000_001, " "), "8 MB"],
] as const) {
  test(`Forge rejects ${name} (${buffer.length} bytes) inline before upload`, async ({ page }) => {
    await openConfig(page);
    await page.getByTestId("forge-file").setInputFiles({ name, mimeType: "application/json", buffer });
    await expect(page.getByTestId("forge-config-status")).toContainText(message);
    await expect(page.getByTestId("forge-config-status")).toHaveAttribute("aria-live", "assertive");
    await expect(page.getByTestId("forge-config-status")).toBeFocused();
    await expect(page.getByTestId("forge-save")).toBeDisabled();
    expect(await writes(page)).toEqual({ uploads: [], saves: 0 });
    await chooseFile(page);
    await expect(page.getByTestId("forge-config-status")).toBeHidden();
  });
}

for (const cancel of [false, true]) {
  test(`Forge editing Replace stages locally and ${cancel ? "Cancel discards it" : "Update adds a version"}`, async ({
    page,
  }) => {
    await openConfig(page, { attachmentId: "7", simulation: "flow", height: 800, theme: "light" });
    await expect(page.getByTestId("forge-save")).toHaveText("Update");
    await expect(page.getByTestId("forge-change")).toHaveText("Replace file");
    await expect(page.getByTestId("forge-summary")).toHaveText("Order flow · Large");
    await expect(page.getByTestId("forge-filename")).toHaveText("orders.diagram.json");
    const picker = page.waitForEvent("filechooser");
    await page.getByTestId("forge-change").click();
    await (await picker).setFiles(validFile("different.diagram.json"));
    await expect(page.getByTestId("forge-card")).toBeFocused();
    expect(await writes(page)).toEqual({ uploads: [], saves: 0 });
    if (cancel) {
      await page.keyboard.press("Escape");
      await expect.poll(() => page.evaluate(() => window.__forgeTest.closed)).toBe(true);
      expect(await writes(page)).toEqual({ uploads: [], saves: 0 });
    } else {
      await page.getByTestId("forge-save").click();
      await expect
        .poll(() => page.evaluate(() => window.__forgeTest.submitted))
        .toEqual({ config: { attachmentId: "7", simulation: "", height: 800, theme: "light" } });
      expect(await writes(page)).toEqual({
        uploads: [
          {
            path: "/wiki/rest/api/content/42/child/attachment/7/data",
            method: "POST",
            filename: "orders.diagram.json",
          },
        ],
        saves: 1,
      });
    }
  });
}

for (const [height, label] of [
  [0, "Auto size"],
  [480, "Small"],
  [640, "Medium"],
  [800, "Large"],
  [713, "Custom (713 px)"],
] as const) {
  test(`Forge options preserve ${height}px and map size presets`, async ({ page }) => {
    await openConfig(page, { attachmentId: "7", height });
    await expect(page.getByTestId("forge-summary")).toHaveText(`Free play · ${label}`);
    await page.getByTestId("forge-options").click();
    await expect(page.getByTestId(`forge-height-${height}`)).toHaveAttribute("aria-pressed", "true");
    if (height !== 713) {
      await page.getByTestId("forge-height-0").click();
      await page.getByTestId(`forge-height-${height}`).click();
    }
    await page.getByTestId("forge-play-mode-saved").click();
    await page.getByTestId("forge-simulation").selectOption("flow");
    await page.getByTestId("forge-theme-dark").click();
    await page.getByTestId("forge-save").click();
    await expect
      .poll(() => page.evaluate(() => window.__forgeTest.submitted))
      .toEqual({ config: { attachmentId: "7", simulation: "flow", height, theme: "dark" } });
    expect((await writes(page)).uploads).toEqual([]);
  });
}

test("Forge no simulations hint, file drop and keyboard Options and Escape", async ({ page }) => {
  await openConfig(page);
  const transfer = await page.evaluateHandle((body) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([body], "dropped.diagram.json", { type: "application/json" }));
    return transfer;
  }, JSON.stringify(textFieldsFixture));
  await page.getByTestId("forge-drop").dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByTestId("forge-card")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("forge-change")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("forge-options")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("forge-options")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("forge-play-mode-saved")).toBeDisabled();
  await expect(page.getByTestId("forge-play-mode-saved")).toHaveAccessibleDescription(
    "This file has no saved simulations. Save one in Live Diagrams to use it here.",
  );
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__forgeTest.closed)).toBe(true);
  expect(await writes(page)).toEqual({ uploads: [], saves: 0 });
});

test("Forge Escape dismisses a simulation popup before cancelling", async ({ page }) => {
  await openConfig(page, { attachmentId: "7", simulation: "flow" });
  await page.getByTestId("forge-options").click();
  await page.getByTestId("forge-simulation").focus();
  await page.keyboard.press("Alt+ArrowDown");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__forgeTest.closed)).toBeUndefined();
  await page.getByTestId("forge-options").focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__forgeTest.closed)).toBe(true);
});

test("Forge permission error focuses inline guidance and never saves config", async ({ page }) => {
  await openConfig(page, {}, { uploadStatus: 403 });
  await chooseFile(page);
  await page.getByTestId("forge-save").click();
  await expect(page.getByTestId("forge-config-status")).toContainText(
    "Check that you can edit this page and add attachments",
  );
  await expect(page.getByTestId("forge-config-status")).toBeFocused();
  expect(await page.evaluate(() => window.__forgeTest.submitted)).toBeUndefined();
  expect((await writes(page)).saves).toBe(0);
  await expect(page.getByTestId("forge-save")).toBeEnabled();
  await page.getByTestId("forge-cancel").click();
  await expect.poll(() => page.evaluate(() => window.__forgeTest.closed)).toBe(true);
});

test("Forge config save retry does not upload another attachment version", async ({ page }) => {
  await openConfig(page, {}, { submitError: true });
  await chooseFile(page);
  await page.getByTestId("forge-save").click();
  await expect(page.getByTestId("forge-config-status")).toContainText("could not save the macro settings");
  await expect(page.getByTestId("forge-config-status")).toBeFocused();
  await page.evaluate(() => {
    window.__forgeTest.submitError = false;
  });
  await page.getByTestId("forge-save").click();
  await expect.poll(() => page.evaluate(() => window.__forgeTest.submitted)).toBeTruthy();
  expect((await writes(page)).uploads).toHaveLength(1);
});

for (const hold of ["context", "list", "download"] as const) {
  test(`Forge config can cancel a stalled ${hold} request`, async ({ page }) => {
    await setup(page, { hold });
    await page.goto(`${origin}/fake/config/index.html`);
    await page.getByTestId("forge-cancel").click();
    await expect.poll(() => page.evaluate(() => window.__forgeTest.closed)).toBe(true);
    if (hold !== "context") await page.evaluate(() => window.__forgeTest.release?.());
    expect(await writes(page)).toEqual({ uploads: [], saves: 0 });
  });
}

test("Forge config remains cancellable when attachments cannot be listed", async ({ page }) => {
  await setup(page, { status: 403 });
  await page.goto(`${origin}/fake/config/index.html`);
  await expect(page.getByTestId("forge-config-status")).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("forge-save")).toBeDisabled();
  await page.getByTestId("forge-cancel").click();
  await expect.poll(() => page.evaluate(() => window.__forgeTest.closed)).toBe(true);
});

test("Forge config recovers from a removed simulation with Free play", async ({ page }) => {
  await openConfig(page, { attachmentId: "7", simulation: "removed" });
  await expect(page.getByTestId("forge-config-status")).toContainText("no longer in this attachment");
  await expect(page.getByTestId("forge-save")).toBeDisabled();
  await page.getByTestId("forge-play-mode-free").click();
  await page.getByTestId("forge-save").click();
  await expect
    .poll(() => page.evaluate(() => window.__forgeTest.submitted))
    .toEqual({ config: { attachmentId: "7", simulation: "", height: 0, theme: "auto" } });
});

for (const width of [320, 160]) {
  test(`Forge configuration fits long filenames at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openConfig(page, { attachmentId: "7" }, { longFilename: true });
    await page.getByTestId("forge-options").click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const box = await page.getByTestId("forge-card").boundingBox();
    if (!box) throw new Error("Attachment card has no box");
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  });
}

for (const direction of ["wide", "tall"] as const) {
  test(`Forge preview fits and centres a ${direction} diagram without unreadable labels`, async ({ page }) => {
    await page.setViewportSize({ width: 688, height: 760 });
    await openConfig(page);
    await chooseFile(
      page,
      undefined,
      JSON.stringify({
        ...textFieldsFixture,
        groups: [],
        annotations: [],
        nodes: textFieldsFixture.nodes.slice(0, 2).map((node, i) => ({
          ...node,
          label: "Service",
          group: undefined,
          x: -300 + (direction === "wide" ? i * 1200 : 0),
          y: -250 + (direction === "tall" ? i * 1200 : 0),
        })),
      }),
    );
    const preview = page.getByTestId("forge-preview");
    for (const width of [688, 320]) {
      await page.setViewportSize({ width, height: 760 });
      await expect(preview).toHaveCSS("height", "140px");
      await expect
        .poll(() =>
          preview.evaluate((svg: SVGSVGElement) => {
            const card = svg.getBoundingClientRect();
            const box = svg.getBBox();
            const matrix = svg.getScreenCTM();
            if (!matrix) throw new Error("Preview has no screen transform");
            const from = new DOMPoint(box.x, box.y).matrixTransform(matrix);
            const to = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix);
            return {
              centred:
                Math.abs((from.x + to.x) / 2 - (card.x + card.width / 2)) < 1 &&
                Math.abs((from.y + to.y) / 2 - (card.y + card.height / 2)) < 1,
              fills: Math.max((to.x - from.x) / card.width, (to.y - from.y) / card.height) >= 0.6,
              padding:
                from.x >= card.x + 11 && from.y >= card.y + 11 && to.x <= card.right - 11 && to.y <= card.bottom - 11,
              aspect: Math.abs((to.x - from.x) / (to.y - from.y) - box.width / box.height) < 0.01,
            };
          }),
        )
        .toEqual({ centred: true, fills: true, padding: true, aspect: true });
      expect(await preview.textContent()).toBe("");
    }
  });
}

test("Forge preview enlarges a small diagram up to 1.5x and keeps readable labels", async ({ page }) => {
  await page.setViewportSize({ width: 688, height: 760 });
  await openConfig(page);
  await chooseFile(
    page,
    undefined,
    JSON.stringify({
      ...textFieldsFixture,
      groups: [],
      annotations: [],
      edges: [],
      nodes: [{ ...textFieldsFixture.nodes[0], group: undefined, x: -300, y: 250 }],
    }),
  );
  const preview = page.getByTestId("forge-preview");
  await expect.poll(() => preview.evaluate((svg: SVGSVGElement) => svg.getScreenCTM()?.a)).toBeCloseTo(1.5, 5);
  expect(await preview.textContent()).toBe("Order service");
});

test("Forge panel owns its insets and full-width footer separator", async ({ page }) => {
  await page.setViewportSize({ width: 688, height: 760 });
  await openConfig(page);
  const box = async (id: string) => {
    const bounds = await page.getByTestId(id).boundingBox();
    if (!bounds) throw new Error(`${id} has no rendered box`);
    return bounds;
  };
  const panel = await box("forge-config");
  const title = await box("forge-title");
  const drop = await box("forge-drop");
  const footer = await box("forge-footer");
  const save = await box("forge-save");
  expect(title.x - panel.x).toBe(20);
  expect(title.y - panel.y).toBe(20);
  expect(drop.y - title.y - title.height).toBe(12);
  expect(footer.x).toBe(panel.x);
  expect(footer.width).toBe(panel.width);
  expect(footer.y - drop.y - drop.height).toBe(14);
  expect(panel.x + panel.width - save.x - save.width).toBe(20);
  expect(panel.y + panel.height - save.y - save.height).toBe(20);
  await chooseFile(page);
  await page.getByTestId("forge-options").click();
  const card = await box("forge-card");
  const summary = await box("forge-summary-row");
  const options = await box("forge-options-panel");
  expect(summary.y - card.y - card.height).toBe(14);
  expect(options.y - summary.y - summary.height).toBe(14);
});

for (const hostTheme of ["light", "dark"] as const) {
  test(`Forge approved states use Confluence ${hostTheme} tokens and screenshots`, async ({ page }, info) => {
    await page.setViewportSize({ width: 688, height: 760 });
    await openConfig(page, {}, { hostTheme });
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(hostTheme);
    const shot = async (state: string) => {
      if (info.repeatEachIndex) return;
      mkdirSync("tests/.output/forge-config-shots", { recursive: true });
      await page
        .getByTestId("forge-config")
        .screenshot({ path: `tests/.output/forge-config-shots/${state}-${hostTheme}.png` });
    };
    await shot("empty");
    await chooseFile(page);
    await page.getByTestId("forge-card").blur();
    await shot("chosen-closed");
    await page.getByTestId("forge-options").click();
    await shot("chosen-open");
    // Real host tokens override fallbacks, including the settings surface with an explicit diagram theme.
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--ds-surface", "rgb(30, 40, 50)");
    });
    await expect(page.getByTestId("forge-config")).toHaveCSS(
      "color",
      hostTheme === "dark" ? "rgb(182, 194, 207)" : "rgb(23, 43, 77)",
    );
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(30, 40, 50)");
    await page.addInitScript(
      ({ hostTheme, body }) => {
        window.__forgeTest = {
          calls: [],
          hostTheme,
          body,
          config: {
            attachmentId: "7",
            simulation: "spike",
            height: 800,
            theme: hostTheme === "dark" ? "light" : "dark",
          },
        };
      },
      { hostTheme, body: chosenDiagram },
    );
    await page.goto(`${origin}/fake/config/index.html`);
    await expect(page.getByTestId("forge-save")).toBeEnabled();
    await expect(page.getByTestId("forge-summary")).toHaveText("Black Friday spike · Large");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(hostTheme);
    await shot("editing");
  });
}
