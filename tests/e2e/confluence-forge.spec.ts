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
// Build each fixture once per invocation; parallel workers must not replace each other's files.
test.describe.configure({ mode: "default" });

test.beforeAll(() => {
  test.setTimeout(120_000);
  for (const args of [["--fake"], []])
    execFileSync(process.execPath, ["integrations/confluence-forge/build.mjs", ...args], {
      cwd: resolve("."),
      stdio: "pipe",
    });
  const files = new Map<string, Buffer>();
  for (const [prefix, directory] of [
    ["fake", "tests/.output/confluence-forge"],
    ["real", "integrations/confluence-forge/dist"],
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
    // A viewer settings effect can write its default after bridge theming has initialized.
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
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
      { path: "/wiki/rest/api/content/42/child/attachment/7/download", method: "GET" },
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
      buffer: Buffer.from(JSON.stringify(textFieldsFixture)),
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
        callBridge: async (method: string) => {
          calls.push(method);
          if (method === "getContext") return { extension: { content: { id: "42" }, config: { attachmentId: "7" } } };
          if (method === "enableTheming") {
            document.documentElement.dataset.colorMode = "dark";
            return;
          }
          if (method === "fetchProduct")
            return { body: diagram, headers: { "content-type": "application/json" }, statusText: "OK", status: 200 };
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
  ]);
  expect(violations).toEqual([]);
  expect(requests.every((url) => url.startsWith(origin + "/"))).toBe(true);
});
