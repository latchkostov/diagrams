import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, pauseClock } from "./fixtures";
import { E2E_PROFILES } from "../../scripts/e2e-profiles.mjs";
import { textFieldsFixture } from "../../src/lab/textFieldsFixture";
import type { ViewerAdapter } from "../../src/export/viewer/adapter";

let server: Server;
let origin: string;
// Deliberately independent of the generated meta policy: hosting may impose this stricter header.
const FORGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'";
test.beforeAll(async () => {
  const directory = join(E2E_PROFILES.e2e.outDir, "viewer");
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")) as { files: string[] };
  const files = new Map(manifest.files.map((name) => [name, readFileSync(join(directory, name))]));
  server = createServer((req, res) => {
    const name = new URL(req.url ?? "/", "http://viewer").pathname.slice(1) || "index.html";
    const content = files.get(name);
    if (content === undefined) {
      res.writeHead(404).end();
      return;
    }
    const type = name.endsWith(".js")
      ? "text/javascript"
      : name.endsWith(".css")
        ? "text/css"
        : name.endsWith(".woff2")
          ? "font/woff2"
          : "text/html";
    res.writeHead(200, { "Content-Type": type, "Content-Security-Policy": FORGE_CSP });
    res.end(content);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((done) => server.close(() => done()));
});

for (const saved of [false, true]) {
  test(`static viewer under Forge CSP: ${saved ? "saved simulation" : "free play"}, height and no persistence`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("request", (r) => requests.push(r.url()));
    await page.clock.install();
    await page.addInitScript(() => {
      const w = window as unknown as {
        violations: string[];
        forbidden: string[];
        events: { type: string; detail: unknown }[];
      };
      w.violations = [];
      w.forbidden = [];
      w.events = [];
      document.addEventListener("securitypolicyviolation", (e) => w.violations.push(e.effectiveDirective));
      // Access to real persistent stores and worker construction must never happen.
      for (const name of ["localStorage", "sessionStorage", "indexedDB", "Worker"]) {
        Object.defineProperty(window, name, {
          configurable: true,
          get() {
            w.forbidden.push(name);
            throw new Error(`Forbidden API: ${name}`);
          },
        });
      }
    });
    await page.goto(origin);
    await page.waitForFunction(() => !!(window as unknown as { liveDiagramsViewer?: unknown }).liveDiagramsViewer);
    const diagram = {
      ...textFieldsFixture,
      ...(saved ? { simulations: [{ id: "flow", title: "Flow", durationMs: 60_000, traffic: [] }] } : {}),
    };
    await page.evaluate((d) => {
      const w = window as unknown as { liveDiagramsViewer: ViewerAdapter; events: { type: string; detail: unknown }[] };
      for (const type of ["loaded", "error", "size"] as const)
        w.liveDiagramsViewer.on(type, (detail) => w.events.push({ type, detail }));
      w.liveDiagramsViewer.load(d);
    }, diagram);
    await expect(page.getByTestId("node-a")).toBeVisible();
    await expect(page.getByTestId("viewer-bundle")).toHaveAttribute("data-live", "0");
    await expect(page.getByTestId("host-embed-brand")).toHaveCount(0);
    await expect(page.getByTestId("palette")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { events: { type: string; detail: { height?: number } }[] }).events.find(
              (e) => e.type === "size",
            )?.detail.height ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    await pauseClock(page);
    await page.clock.runFor(10_000);
    await expect(page.getByTestId("viewer-bundle")).toHaveAttribute("data-live", "0");
    // The viewer's existing Live button is the click-to-play entry point, including with no saved runs.
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
    if (saved) {
      await page.evaluate(() =>
        (window as unknown as { liveDiagramsViewer: ViewerAdapter }).liveDiagramsViewer.play("flow"),
      );
      await expect(page.getByTestId("live-sim-picker")).toHaveValue("flow");
    }
    await page.evaluate(() => (window as unknown as { liveDiagramsViewer: ViewerAdapter }).liveDiagramsViewer.stop());
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
    await page.evaluate(async () => {
      await document.fonts.load('14px "Mona Sans Variable"');
      await document.fonts.load('14px "Geist Mono Variable"');
    });
    expect(requests.filter((url) => url.endsWith(".woff2"))).toHaveLength(2);
    expect(requests.every((url) => url.startsWith(origin + "/"))).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { violations: string[] }).violations)).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { forbidden: string[] }).forbidden)).toEqual([]);
    expect(errors).toEqual([]);
    const events = await page.evaluate(() => (window as unknown as { events: { type: string }[] }).events);
    expect(events.filter((e) => e.type === "loaded")).toHaveLength(1);
    expect(events.filter((e) => e.type === "error")).toEqual([]);
    await page.goto("about:blank");
  });
}
