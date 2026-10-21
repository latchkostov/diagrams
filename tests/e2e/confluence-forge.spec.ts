import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, readdirSync } from "node:fs";
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

test("Forge config selects a simulation and stores only the four allowed settings", async ({ page }) => {
  await setup(page);
  await page.goto(`${origin}/fake/config/index.html`);
  await expect(page.getByTestId("forge-save")).toBeEnabled();
  await expect(page.getByTestId("forge-attachment")).toHaveValue("7");
  await page.getByTestId("forge-simulation").selectOption("flow");
  await page.getByTestId("forge-height").selectOption("600");
  await page.getByTestId("forge-theme").selectOption("light");
  await page.getByTestId("forge-save").click();
  await expect
    .poll(() => page.evaluate(() => window.__forgeTest.submitted))
    .toEqual({ config: { attachmentId: "7", simulation: "flow", height: 600, theme: "light" } });
});

for (const replacing of [false, true]) {
  test(`Forge config ${replacing ? "replaces the current attachment by ID" : "uploads a new attachment"}`, async ({
    page,
  }) => {
    await setup(page);
    await page.goto(`${origin}/fake/config/index.html`);
    await expect(page.getByTestId("forge-save")).toBeEnabled();
    await page.getByTestId("forge-file").setInputFiles({
      name: "local.livediagram.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          ...textFieldsFixture,
          title: "Uploaded flow",
          nodes: textFieldsFixture.nodes.map((node) => ({ ...node, label: "Uploaded " + node.label })),
        }),
      ),
    });
    await page.getByTestId(replacing ? "forge-replace" : "forge-upload").click();
    await expect(page.getByTestId("forge-config-status")).toHaveText("Attachment saved to the page.");
    const posts = await page.evaluate(() => window.__forgeTest.calls.filter((call) => call.method === "POST"));
    expect(posts).toEqual([
      {
        path: `/wiki/rest/api/content/42/child/attachment${replacing ? "/7/data" : ""}`,
        method: "POST",
        filename: replacing ? "orders.livediagram.json" : "local.livediagram.json",
      },
    ]);
    expect(await page.evaluate(() => window.__forgeTest.submitted)).toBeUndefined();
    await expect(page.getByTestId("forge-attachment")).toHaveValue(replacing ? "7" : "9");
    await page.getByTestId("forge-save").click();
    const saved = await page.evaluate(() => window.__forgeTest.submitted);
    expect(saved).toEqual({
      config: { attachmentId: replacing ? "7" : "9", simulation: "", height: 0, theme: "auto" },
    });
    const uploaded = await page.evaluate(() => window.__forgeTest.uploaded);
    await page.addInitScript(
      ({ saved, uploaded }) => {
        window.__forgeTest = { calls: [], config: (saved as { config: Record<string, unknown> }).config, uploaded };
      },
      { saved, uploaded },
    );
    await page.goto(`${origin}/fake/view/index.html`);
    await expect(page.getByTestId("node-a")).toContainText("Uploaded Order service");
    expect(await page.evaluate(() => window.__forgeTest.calls)).toContainEqual({
      path: `/wiki/api/v2/attachments/${replacing ? "7" : "9"}`,
      method: "GET",
    });
  });
}

test("Forge config remains cancellable when the reader cannot list attachments", async ({ page }) => {
  await setup(page, { status: 403 });
  await page.goto(`${origin}/fake/config/index.html`);
  await expect(page.getByTestId("forge-config-status")).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("forge-save")).toBeDisabled();
  await page.getByTestId("forge-cancel").click();
  await expect.poll(() => page.evaluate(() => window.__forgeTest.closed)).toBe(true);
});

for (const hold of ["context", "list", "download"] as const) {
  test(`Forge config can cancel a stalled ${hold} request`, async ({ page }) => {
    await setup(page, { hold });
    await page.goto(`${origin}/fake/config/index.html`);
    await page.getByTestId("forge-cancel").click();
    await expect.poll(() => page.evaluate(() => window.__forgeTest.closed)).toBe(true);
  });
}

test("Forge config recovers from a removed simulation by selecting Free play", async ({ page }) => {
  await setup(page, { config: { attachmentId: "7", simulation: "removed" } });
  await page.goto(`${origin}/fake/config/index.html`);
  await expect(page.getByTestId("forge-config-status")).toContainText("no longer in this attachment");
  await expect(page.getByTestId("forge-save")).toBeDisabled();
  await page.getByTestId("forge-simulation").selectOption("");
  await page.getByTestId("forge-save").click();
  await expect
    .poll(() => page.evaluate(() => window.__forgeTest.submitted))
    .toEqual({ config: { attachmentId: "7", simulation: "", height: 0, theme: "auto" } });
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
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __forgeSdkCalls: string[] }).__forgeSdkCalls)).toEqual([
    "getContext",
    "enableTheming",
    "fetchProduct",
    "fetchProduct",
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

test("Forge config restores picker and failed-save focus without stealing Cancel focus", async ({ page }) => {
  await setup(page, { submitError: true });
  await page.goto(`${origin}/fake/config/index.html`);
  const picker = page.getByTestId("forge-attachment");
  await expect(page.getByTestId("forge-save")).toBeEnabled();
  await picker.focus();
  await page.keyboard.press("ArrowUp");
  await expect(picker).toHaveValue("");
  await expect(picker).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(picker).toHaveValue("7");
  await expect(page.getByTestId("forge-save")).toBeEnabled();
  await expect(picker).toBeFocused();
  await page.getByTestId("forge-save").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("forge-config-status")).toContainText("could not save the macro settings");
  await expect(page.getByTestId("forge-save")).toBeFocused();
  // Hold a real selection download, move to Cancel, then let it complete.
  await page.evaluate(() => {
    window.__forgeTest.hold = "download";
  });
  await picker.selectOption("");
  await picker.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("forge-fields")).toHaveJSProperty("disabled", true);
  await page.getByTestId("forge-cancel").focus();
  await page.evaluate(() => window.__forgeTest.release?.());
  await expect(page.getByTestId("forge-save")).toBeEnabled();
  await expect(page.getByTestId("forge-cancel")).toBeFocused();
});

for (const width of [320, 160]) {
  test(`Forge configuration shrinks with long filenames at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await setup(page, { longFilename: true });
    await page.goto(`${origin}/fake/config/index.html`);
    await expect(page.getByTestId("forge-save")).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const box = await page.getByTestId("forge-attachment").boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("Attachment picker has no box");
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  });
}

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
