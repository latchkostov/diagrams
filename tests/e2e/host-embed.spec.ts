import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { Frame, Page, Request } from "@playwright/test";
import { test as base, expect, E2E_TARGET, expectNoErrors, pageLoadTimeout, shareVia } from "./fixtures";
import { textFieldsFixture } from "../../src/lab/textFieldsFixture";

// Host-supplied embeds (docs/EMBEDDING.md): a page on another origin loads the <live-diagram> web component from
// the app, fetches the diagram from its own server (with its own session cookie) and hands it to the viewer
// frame with postMessage. The host page is a real little server on 127.0.0.1 (another site than the app on
// localhost; a free port per test, so parallel workers never collide), under a strict CSP of its own, from
// tests/fixtures/host-embed/. (Not a Playwright route: Chrome's local network access checks treat a routed page
// as public and refuse to let it frame localhost.)
// Selectors are data-testid only (the component's iframe carries data-testid="live-diagram-frame").

const PROTOCOL = "livediagrams.embed.v1";
/** Appears only in the host's copy of the diagram: never in a URL or a request to the app. */
const SECRET = "ZX9Q7731";
const DIAGRAM_PATH = "/api/diagrams/orders.diagram.json";

const fixtures = join(process.cwd(), "tests", "fixtures", "host-embed");
const fixture = (name: string) => readFileSync(join(fixtures, name), "utf8");

/** A sibling frame of the viewer, on the host's origin, that tries to drive it (and then says it did). */
const SIBLING_JS = `
const target = parent.__viewerFrame().contentWindow;
target.postMessage({ protocol: "${PROTOCOL}", type: "pause" }, "*");
target.postMessage({ protocol: "${PROTOCOL}", type: "load", diagram: { format: "diagrams/v1", title: "Injected", nodes: [], edges: [] } }, "*");
parent.postMessage("sibling-posted", location.origin);
`;

/** The Kafka example as the host's own, confidential diagram. */
function hostDiagram() {
  const d = JSON.parse(readFileSync(join(process.cwd(), "src", "examples", "kafka-order-pipeline.json"), "utf8"));
  d.title = `Acme ledger ${SECRET}`;
  for (const n of d.nodes) if (n.id === "payments") n.label = `Payments vault ${SECRET}`;
  return d as { title: string; nodes: { id: string; label: string }[]; simulations: { id: string }[] };
}

interface HostEvent {
  type: string;
  detail: Record<string, unknown>;
}
declare global {
  interface Window {
    __events?: HostEvent[];
    __raw?: { origin: string; data: unknown }[];
    __csp?: string[];
    /** tests/fixtures/host-embed/host.js: the <live-diagram> element's iframe. */
    __viewerFrame?: () => HTMLIFrameElement | null;
  }
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** Test-scoped web servers on 127.0.0.1 (closed when the test ends): `start` returns the new one's origin. */
const test = base.extend<{ servers: { start(handler: Handler): Promise<string> } }>({
  // eslint-disable-next-line no-empty-pattern
  servers: async ({}, use) => {
    const open: ReturnType<typeof createServer>[] = [];
    await use({
      async start(handler) {
        const server = createServer(handler);
        open.push(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      },
    });
    for (const server of open) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
});

/** Starts the host app (the page, its script and style, and the diagram behind its session cookie). */
async function serveHost(
  page: Page,
  servers: { start(handler: Handler): Promise<string> },
  attrs: string,
  { appBase }: { appBase: string },
) {
  const appOrigin = new URL(appBase).origin;
  const html = fixture("host-page.template").replaceAll("__APP__", appBase).replace("__ATTRS__", attrs);
  // A careful host's policy: no inline scripts or styles, the viewer's origin allowed for its script and frame.
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${appOrigin}`,
    "style-src 'self'",
    `frame-src 'self' ${appOrigin}`,
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
  const diagramRequests: { cookie: string }[] = [];
  /** /api/diagrams/slow.json answers only once the test calls release(). */
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  /** /api/diagrams/huge.json: how much it got to send before the page hung up. */
  const huge = { sent: 0, closedEarly: false };
  const send = (res: ServerResponse, status: number, type: string, body: string, headers = {}) => {
    res.writeHead(status, { "Content-Type": type, ...headers });
    res.end(body);
  };
  const origin = await servers.start((req, res) => {
    const path = new URL(req.url ?? "/", "http://host").pathname;
    if (path === "/") return send(res, 200, "text/html", html, { "Content-Security-Policy": csp });
    if (path === "/host.js") return send(res, 200, "text/javascript", fixture("host.js"));
    if (path === "/host.css") return send(res, 200, "text/css", fixture("host.css"));
    if (path === "/sibling.html") return send(res, 200, "text/html", `<script src="/sibling.js"></script>`);
    if (path === "/sibling.js") return send(res, 200, "text/javascript", SIBLING_JS);
    if (path === "/api/diagrams/slow.json") {
      void released.then(() => send(res, 200, "application/json", JSON.stringify(hostDiagram())));
      return;
    }
    if (path === "/api/diagrams/huge.json") {
      // 40 MB of JSON text, streamed with no Content-Length: the page must stop reading at its 8 MB limit.
      res.writeHead(200, { "Content-Type": "application/json" });
      const chunk = "x".repeat(1_000_000);
      res.on("close", () => (huge.closedEarly = !res.writableFinished));
      const pump = () => {
        while (huge.sent < 40) {
          if (res.destroyed) return;
          huge.sent++;
          if (!res.write(chunk)) return void res.once("drain", pump);
        }
        res.end();
      };
      return pump();
    }
    if (path === DIAGRAM_PATH) {
      const cookie = req.headers.cookie ?? "";
      diagramRequests.push({ cookie });
      // The host's own access control: no session, no diagram.
      if (!cookie.includes("host_session=signed-in")) return send(res, 401, "text/plain", "sign in");
      return send(res, 200, "application/json", JSON.stringify(hostDiagram()));
    }
    send(res, 404, "text/plain", "");
  });
  await page.context().addCookies([{ name: "host_session", value: "signed-in", url: origin }]);
  return { origin, diagramRequests, release, huge };
}

/** Every request the page (and its frames and workers) makes to the app's origin, with its body. */
function recordAppRequests(page: Page, appOrigin: string) {
  const seen: { url: string; body: string }[] = [];
  page.on("request", (r: Request) => {
    if (new URL(r.url()).origin === appOrigin) seen.push({ url: r.url(), body: r.postData() ?? "" });
  });
  return seen;
}

/** CSP violations in every frame (the host page's policy and the app's). */
async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = (window.__csp = []);
    document.addEventListener("securitypolicyviolation", (e) =>
      seen.push(`${e.effectiveDirective} blocked ${e.blockedURI || "(inline)"} at ${e.sourceFile}:${e.lineNumber}`),
    );
  });
  return async () => {
    const found: string[] = [];
    for (const f of page.frames())
      found.push(...((await f.evaluate(() => window.__csp ?? []).catch(() => [])) as string[]));
    return found;
  };
}

const events = (page: Page, type?: string) =>
  page.evaluate((t) => (window.__events ?? []).filter((e) => !t || e.type === t), type);
const lastEvent = async (page: Page, type: string) => (await events(page, type)).at(-1)?.detail;
const el = (page: Page) => page.getByTestId("host-diagram");
/** Calls a method of the <live-diagram> element. */
const call = (page: Page, method: string, ...args: unknown[]) =>
  el(page).evaluate(
    (node, [m, a]) =>
      (node as unknown as Record<string, (...x: unknown[]) => unknown>)[m as string](...(a as unknown[])),
    [method, args] as const,
  );

async function embedFrame(page: Page): Promise<Frame> {
  const handle = await page.getByTestId("live-diagram-frame").elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error("no viewer frame");
  return frame;
}

test.describe("host-supplied embeds", () => {
  test.beforeEach(({ baseURL }) => {
    test.skip(!baseURL, "needs the app server");
  });

  test("the host page supplies the diagram: it renders, plays, takes commands and reports back", async ({
    page,
    baseURL,
    servers,
    consoleErrors,
  }) => {
    test.slow();
    const appBase = new URL("./", baseURL).href;
    const appOrigin = new URL(appBase).origin;
    const violations = await watchCsp(page);
    const appRequests = recordAppRequests(page, appOrigin);
    const { origin: HOST, diagramRequests } = await serveHost(
      page,
      servers,
      `src-json="${DIAGRAM_PATH}" simulation="black-friday" autoplay`,
      {
        appBase,
      },
    );
    const res = await page.goto(`${HOST}/`);
    expect(res?.ok()).toBe(true);

    // The web component made the frame: sandboxed, at the viewer's URL with the host's origin and nothing else.
    const iframe = page.getByTestId("live-diagram-frame");
    await expect(iframe).toBeAttached();
    expect(await iframe.getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox",
    );
    const src = new URL((await iframe.getAttribute("src")) ?? "");
    expect(src.origin).toBe(appOrigin);
    expect(Object.fromEntries(src.searchParams)).toEqual({ embed: "1", host: "1", hostOrigin: HOST });

    const view = iframe.contentFrame();
    await expect(view.getByTestId("host-embed-view")).toHaveAttribute("data-status", "ready", {
      timeout: pageLoadTimeout(),
    });
    await expect(view.getByTestId("node-payments")).toContainText(`Payments vault ${SECRET}`);
    await expect(view.getByTestId("diagram-title")).toHaveText(`Acme ledger ${SECRET}`);

    // The page fetched it itself, with its session cookie.
    expect(diagramRequests).toHaveLength(1);
    expect(diagramRequests[0].cookie).toContain("host_session=signed-in");
    expect(await lastEvent(page, "loaded")).toMatchObject({
      title: `Acme ledger ${SECRET}`,
      nodes: 15,
      simulations: [{ id: "black-friday" }, { id: "payments-outage" }],
    });

    // Autoplay: the chosen simulation runs, and its particles move.
    await expect(view.getByTestId("live-controls")).toBeVisible();
    await expect(view.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
    await expect.poll(() => lastEvent(page, "simulationchanged")).toEqual({ simulation: "black-friday" });
    await expect.poll(() => lastEvent(page, "playstate")).toEqual({ playing: true, speed: 1 });
    const canvas = view.getByTestId("live-canvas");
    await expect.poll(async () => Number(await canvas.getAttribute("data-particles"))).toBeGreaterThan(0);
    const clock = view.getByTestId("live-clock");
    const ms = async () => Number(await clock.getAttribute("data-ms"));
    const t0 = await ms();
    await expect.poll(ms).toBeGreaterThan(t0);

    // pause, then play.
    await call(page, "pause");
    await expect(view.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
    await expect.poll(() => lastEvent(page, "playstate")).toEqual({ playing: false, speed: 1 });
    const paused = await ms();
    await page.waitForTimeout(500);
    expect(await ms()).toBe(paused);
    await call(page, "play");
    await expect.poll(() => lastEvent(page, "playstate")).toEqual({ playing: true, speed: 1 });
    await expect.poll(ms).toBeGreaterThan(paused);

    // setSpeed and selectSimulation.
    await call(page, "setSpeed", 4);
    await expect.poll(() => lastEvent(page, "playstate")).toEqual({ playing: true, speed: 4 });
    await call(page, "selectSimulation", "payments-outage");
    await expect.poll(() => lastEvent(page, "simulationchanged")).toEqual({ simulation: "payments-outage" });
    await expect(view.getByTestId("live-sim-picker")).toHaveValue("payments-outage");

    // highlight, and clearing it.
    await call(page, "highlight", ["payments", "not-a-node"]);
    await expect(view.getByTestId("host-highlight-payments")).toBeVisible();
    await call(page, "highlight", []);
    await expect(view.getByTestId("host-highlight-payments")).toHaveCount(0);

    // nodeClick: a click on a node reports its id and label (paused, so the camera holds still).
    await call(page, "pause");
    await expect(view.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
    await page.waitForTimeout(1000);
    await view.getByTestId("node-orders").click();
    await expect.poll(() => lastEvent(page, "nodeclick")).toEqual({ nodeId: "orders", label: "Order service" });

    // setTheme.
    await call(page, "setTheme", "dark");
    const themed = await embedFrame(page);
    await expect.poll(() => themed.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");

    // Auto-height: the frame takes the height the viewer asks for, and a narrower page asks for less.
    const resized = Number((await lastEvent(page, "resize"))?.height);
    expect(resized).toBeGreaterThan(200);
    await expect.poll(async () => Math.round((await iframe.boundingBox())?.height ?? 0)).toBe(resized);
    await page.setViewportSize({ width: 700, height: 900 });
    await expect.poll(async () => Number((await lastEvent(page, "resize"))?.height)).toBeLessThan(resized);
    const narrow = Number((await lastEvent(page, "resize"))?.height);
    await expect.poll(async () => Math.round((await iframe.boundingBox())?.height ?? 0)).toBe(narrow);

    // The only way out of the viewer is a plain link to the site: no payload.
    const brand = view.getByTestId("host-embed-brand");
    await expect(brand).toHaveAttribute("href", appBase);
    await expect(view.getByTestId("embed-open-in-app")).toHaveCount(0);

    // Privacy: the diagram never reached a URL, a request to the app, or the frame's storage.
    const frame = await embedFrame(page);
    expect(frame.url()).not.toContain(SECRET);
    expect(new URL(frame.url()).hash).toBe("");
    expect(appRequests.length).toBeGreaterThan(5);
    for (const r of appRequests) {
      expect(decodeURIComponent(r.url), r.url).not.toContain(SECRET);
      expect(r.body, r.url).not.toContain(SECRET);
      expect(r.url).not.toMatch(/[#&?]d=/);
    }
    const stored = await frame.evaluate(() =>
      JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie, location.href]),
    );
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain("Payments vault");

    expect(await violations()).toEqual([]);
    expectNoErrors(consoleErrors);
  });

  test("ignores other windows and origins, never posts to *, and rejects an oversized load", async ({
    page,
    baseURL,
    servers,
    consoleErrors,
  }) => {
    test.slow();
    const appBase = new URL("./", baseURL).href;
    const { origin: HOST } = await serveHost(page, servers, `src-json="${DIAGRAM_PATH}" autoplay`, { appBase });
    await page.goto(`${HOST}/`);
    const view = page.getByTestId("live-diagram-frame").contentFrame();
    await expect(view.getByTestId("host-embed-view")).toHaveAttribute("data-status", "ready", {
      timeout: pageLoadTimeout(),
    });
    await expect.poll(() => lastEvent(page, "playstate")).toEqual({ playing: true, speed: 1 });

    // Another window of the host's own origin (a sibling frame, /sibling.html) is not the parent: its pause and
    // load are ignored. Its script posts to the viewer itself, so the messages' source is the sibling.
    await page.evaluate(() => {
      const sibling = document.createElement("iframe");
      sibling.dataset.testid = "host-sibling";
      sibling.src = "/sibling.html";
      document.body.append(sibling);
    });
    await expect
      .poll(() => page.evaluate(() => (window.__raw ?? []).some((m) => m.data === "sibling-posted")))
      .toBe(true);
    await page.waitForTimeout(800);
    await expect(view.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
    await expect(view.getByTestId("diagram-title")).toHaveText(`Acme ledger ${SECRET}`);

    // Unknown message types and other protocols are ignored without a reply.
    const before = (await events(page, "error")).length;
    await page.evaluate(
      ([protocol]) => {
        const frame = window.__viewerFrame?.();
        const target = frame?.contentWindow;
        if (!frame || !target) throw new Error("no viewer frame");
        const origin = new URL(frame.src).origin;
        target.postMessage({ protocol, type: "eval", code: "alert(1)" }, origin);
        target.postMessage({ protocol: "someone.else.v1", type: "pause" }, origin);
        target.postMessage("pause", origin);
      },
      [PROTOCOL],
    );
    await page.waitForTimeout(500);
    expect((await events(page, "error")).length).toBe(before);
    await expect(view.getByTestId("live-play")).toHaveAttribute("data-state", "playing");

    // A load over the size limit is refused before it's parsed, and the diagram on screen stays.
    const refused = await el(page).evaluate((node) =>
      (node as unknown as { load(d: string): Promise<unknown> }).load("x".repeat(8_000_001)).then(
        () => "loaded",
        (e: Error & { code?: string }) => e.code,
      ),
    );
    expect(refused).toBe("too_large");
    expect(await lastEvent(page, "error")).toMatchObject({ code: "too_large", message: /too large/ });
    await expect(view.getByTestId("diagram-title")).toHaveText(`Acme ledger ${SECRET}`);

    // An invalid diagram gets the validator's reason.
    const invalid = await el(page).evaluate((node) =>
      (node as unknown as { load(d: unknown): Promise<unknown> }).load({ format: "diagrams/v1", title: "x" }).then(
        () => "loaded",
        (e: Error & { code?: string }) => e.code,
      ),
    );
    expect(invalid).toBe("invalid_diagram");

    // Every protocol message the host page received came from the viewer's origin.
    const raw = (await page.evaluate(() => window.__raw ?? [])).filter((m) => m.data !== "sibling-posted");
    expect(raw.length).toBeGreaterThan(3);
    for (const m of raw) {
      expect(m.origin).toBe(new URL(appBase).origin);
      expect(m.data).toMatchObject({ protocol: PROTOCOL });
    }
    expectNoErrors(consoleErrors);
  });

  test("a parent at another origin than hostOrigin hears nothing and can't load a diagram", async ({
    page,
    baseURL,
    servers,
  }) => {
    const appBase = new URL("./", baseURL).href;
    // A page at one origin frames the viewer naming another origin (the real host's) as its host: replies go to
    // that origin only, so the browser drops them. If the viewer ever posted to "*", this page would hear `ready`.
    const { origin: HOST } = await serveHost(page, servers, "", { appBase });
    const src = `${appBase}?embed=1&host=1&hostOrigin=${encodeURIComponent(HOST)}`;
    const FOREIGN = await servers.start((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<!doctype html><script>window.__raw=[];addEventListener("message",e=>__raw.push({origin:e.origin,data:e.data}))</script>` +
          `<iframe data-testid="foreign-frame" src="${src}" width="800" height="400"></iframe>`,
      );
    });
    await page.goto(`${FOREIGN}/`);
    const view = page.getByTestId("foreign-frame").contentFrame();
    await expect(view.getByTestId("host-embed-waiting")).toBeVisible({ timeout: pageLoadTimeout() });
    await page.evaluate(
      ([protocol]) => {
        const target = document.querySelector<HTMLIFrameElement>('[data-testid="foreign-frame"]')?.contentWindow;
        if (!target) throw new Error("no viewer frame");
        target.postMessage(
          { protocol, type: "load", diagram: { format: "diagrams/v1", title: "Injected", nodes: [], edges: [] } },
          "*",
        );
      },
      [PROTOCOL],
    );
    await page.waitForTimeout(1000);
    await expect(view.getByTestId("host-embed-waiting")).toBeVisible();
    expect(await page.evaluate(() => window.__raw ?? [])).toEqual([]);
  });

  test("without hostOrigin the viewer explains what's missing", async ({ page }) => {
    await page.goto("./?embed=1&host=1");
    await expect(page.getByTestId("host-embed-error")).toContainText("hostOrigin");
  });

  test("the web component is served to other sites (CORS, cache) and the viewer may be framed", async ({
    request,
    baseURL,
  }) => {
    test.skip(E2E_TARGET !== "build", "the production server's headers");
    const HOST = "https://app.example.com";
    const js = await request.get(new URL("./embed/live-diagram.js", baseURL).href, { headers: { Origin: HOST } });
    expect(js.ok()).toBe(true);
    expect(js.headers()["content-type"]).toMatch(/javascript/);
    expect(js.headers()["access-control-allow-origin"]).toBe("*");
    expect(js.headers()["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(js.headers()["cache-control"]).toContain("max-age=3600");
    const viewer = await request.get(new URL(`./?embed=1&host=1&hostOrigin=${encodeURIComponent(HOST)}`, baseURL).href);
    const csp = viewer.headers()["content-security-policy"];
    expect(csp).toContain("frame-ancestors *");
    expect(csp).toMatch(/connect-src 'self'/);
  });
});

test.describe("host-supplied embeds: timing and requests", () => {
  /** A host page with an empty <live-diagram> (or `attrs`); the test drives it. */
  async function emptyHost(page: Page, servers: { start(h: Handler): Promise<string> }, baseURL: string, attrs = "") {
    const appBase = new URL("./", baseURL).href;
    const host = await serveHost(page, servers, attrs, { appBase });
    await page.goto(`${host.origin}/`);
    await page.evaluate(() => customElements.whenDefined("live-diagram"));
    return host;
  }
  const view = (page: Page) => page.getByTestId("live-diagram-frame").contentFrame();
  /** load() through the element, all at once: "loaded:<title>" or each rejection's code. */
  const loadVia = (page: Page, diagrams: unknown[], options: Record<string, unknown> = {}) =>
    el(page).evaluate(
      (node, [list, o]) =>
        Promise.all(
          (list as unknown[]).map((d) =>
            (node as unknown as { load(d: unknown, o: unknown): Promise<{ title: string }> }).load(d, o).then(
              (r) => `loaded:${r.title}`,
              (e: Error & { code?: string }) => e.code ?? "no code",
            ),
          ),
        ),
      [diagrams, options] as const,
    );
  const titled = (title: string) => ({ ...hostDiagram(), title });

  for (const theme of ["light", "dark"] as const) {
    test(`host embeds preserve custom background tint and read-only annotations in ${theme}`, async ({
      page,
      baseURL,
      servers,
      consoleErrors,
    }) => {
      const violations = await watchCsp(page);
      await emptyHost(page, servers, baseURL ?? "");
      expect(await loadVia(page, [textFieldsFixture], { theme })).toEqual(["loaded:Fields"]);
      const canvas = view(page).getByTestId("canvas-wrap");
      await expect(view(page).getByTestId("annotation-n1")).toBeVisible();
      const plain = await canvas.evaluate((el) => getComputedStyle(el).backgroundColor);
      const color = "#FF000080";
      expect(await loadVia(page, [{ ...textFieldsFixture, color }], { theme })).toEqual(["loaded:Fields"]);
      await expect
        .poll(() => canvas.evaluate((el) => getComputedStyle(el).getPropertyValue("--diagram-color").trim()))
        .toBe(color);
      const tinted = await canvas.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(tinted).not.toBe(plain);
      await expect(view(page).getByTestId("rf__wrapper")).toHaveCSS("background-color", tinted);
      await view(page).getByTestId("annotation-n1").dblclick();
      await expect(view(page).getByTestId("annotation-editor")).toHaveCount(0);
      await expect(view(page).getByTestId("inspector")).toHaveCount(0);
      expect(await violations()).toEqual([]);
      expectNoErrors(consoleErrors);
    });
  }

  test("host embeds ignore invalid colour objects and acknowledge the loaded diagram", async ({
    page,
    baseURL,
    servers,
    consoleErrors,
  }) => {
    const violations = await watchCsp(page);
    await emptyHost(page, servers, baseURL ?? "");
    expect(await loadVia(page, [{ ...textFieldsFixture, color: { toString: null } }])).toEqual(["loaded:Fields"]);
    await expect(view(page).getByTestId("diagram-title")).toHaveText("Fields");
    await expect(view(page).getByTestId("annotation-n1")).toBeVisible();
    expect(
      await view(page)
        .getByTestId("canvas-wrap")
        .evaluate((el) => el.style.getPropertyValue("--diagram-color")),
    ).toBe("");
    expect(await events(page, "error")).toEqual([]);
    expect(await violations()).toEqual([]);
    expectNoErrors(consoleErrors);
  });

  test(
    "the viewer says ready once, so the element loads its diagram once",
    { tag: "@dev" },
    async ({ page, baseURL, servers }) => {
      // On the dev server, where React's StrictMode runs effects twice: the viewer said `ready` twice there, and the
      // element, answering each with its current diagram (as a reloaded frame needs), loaded it twice (nightly #78).
      test.slow();
      await emptyHost(page, servers, baseURL ?? "");
      expect(await loadVia(page, [titled("Once")])).toEqual(["loaded:Once"]);
      // Both of a doubled `ready` come before the first `loaded`: the frame sends them as it starts.
      expect(await events(page, "ready")).toHaveLength(1);
    },
  );

  test("commands sent right after loaded, before the live session is up, still apply", async ({
    page,
    baseURL,
    servers,
    consoleErrors,
  }) => {
    test.slow();
    await emptyHost(page, servers, baseURL ?? "");
    // A static load, then play at once: live view isn't on yet (and may still be downloading).
    await el(page).evaluate(async (node, d) => {
      const n = node as unknown as { load(d: unknown): Promise<unknown>; play(): void };
      await n.load(d);
      n.play();
    }, titled("First"));
    await expect(view(page).getByTestId("live-play")).toHaveAttribute("data-state", "playing", {
      timeout: pageLoadTimeout(),
    });

    // An autoplay load, then pause at once: it ends paused.
    await el(page).evaluate(async (node, d) => {
      const n = node as unknown as { load(d: unknown, o: unknown): Promise<unknown>; pause(): void };
      await n.load(d, { simulation: "black-friday", autoplay: true });
      n.pause();
    }, titled("Second"));
    await expect(view(page).getByTestId("diagram-title")).toHaveText("Second");
    await expect(view(page).getByTestId("live-play")).toHaveAttribute("data-state", "paused", {
      timeout: pageLoadTimeout(),
    });
    await expect.poll(() => lastEvent(page, "playstate")).toMatchObject({ playing: false });

    // A static load, then a simulation switch at once: live view starts on it.
    await el(page).evaluate(async (node, d) => {
      const n = node as unknown as { load(d: unknown): Promise<unknown>; selectSimulation(id: string): void };
      await n.load(d);
      n.selectSimulation("payments-outage");
    }, titled("Third"));
    await expect(view(page).getByTestId("live-sim-picker")).toHaveValue("payments-outage", {
      timeout: pageLoadTimeout(),
    });
    await expect.poll(() => lastEvent(page, "simulationchanged")).toEqual({ simulation: "payments-outage" });
    expectNoErrors(consoleErrors);
  });

  test("every load settles: superseded before ready, refused by the rate limit, or too large to send", async ({
    page,
    baseURL,
    servers,
    consoleErrors,
  }) => {
    test.slow();
    await emptyHost(page, servers, baseURL ?? "");
    // Two loads before the viewer is ready (a fresh element: one before it's even in the page, one while its
    // frame is still loading): the first is superseded, the second shown.
    const early = await page.evaluate(
      ([a, b]) => {
        document.querySelector('[data-testid="host-diagram"]')?.remove();
        const fresh = document.createElement("live-diagram") as HTMLElement & {
          load(d: unknown): Promise<{ title: string }>;
        };
        fresh.dataset.testid = "host-diagram";
        const settle = (p: Promise<{ title: string }>) =>
          p.then(
            (r) => `loaded:${r.title}`,
            (e: Error & { code?: string }) => e.code ?? "no code",
          );
        const first = settle(fresh.load(a));
        document.querySelector('[data-testid="host-main"]')?.append(fresh);
        const second = settle(fresh.load(b));
        return Promise.all([first, second]);
      },
      [titled("A"), titled("B")],
    );
    expect(early).toEqual(["superseded", "loaded:B"]);
    await expect(view(page).getByTestId("diagram-title")).toHaveText("B");

    // A burst past the load limit (5 at once, then one every 2 s): every promise settles.
    await page.waitForTimeout(2500);
    const burst = await loadVia(
      page,
      Array.from({ length: 8 }, (_, i) => titled(`Burst ${i + 1}`)),
    );
    expect(burst).toHaveLength(8);
    const accepted = burst.filter((r) => r.startsWith("loaded:"));
    expect(accepted.length).toBeGreaterThanOrEqual(4);
    expect(accepted.length).toBeLessThan(8);
    expect(burst.filter((r) => r === "rate_limited")).toHaveLength(8 - accepted.length);
    const shown = accepted[accepted.length - 1].slice("loaded:".length);
    await expect(view(page).getByTestId("diagram-title")).toHaveText(shown);

    // An object whose JSON would be huge (shared references) is refused before it's copied to the frame.
    const refused = await el(page).evaluate((node) => {
      let leaf: Record<string, unknown> = { s: "x".repeat(10) };
      for (let i = 0; i < 25; i++) leaf = { a: leaf, b: leaf };
      return (node as unknown as { load(d: unknown): Promise<unknown> })
        .load({ format: "diagrams/v1", nodes: [], edges: [], extra: leaf })
        .then(
          () => "loaded",
          (e: Error & { code?: string }) => e.code,
        );
    });
    expect(refused).toBe("too_large");
    await expect(view(page).getByTestId("diagram-title")).toHaveText(shown);
    expectNoErrors(consoleErrors);
  });

  test("a pending src-json response can't replace a newer diagram, and an oversized one stops downloading", async ({
    page,
    baseURL,
    servers,
    consoleErrors,
  }) => {
    test.slow();
    // The host page's fetch of the held response, wrapped to say when the element is done with it: aborted (a newer
    // load cancels it), or its body read to the end. Either way the element decides at once (in the same task), so
    // anything that decision sends to the viewer goes before whatever the page sends next.
    await page.addInitScript(() => {
      if (window !== window.top) return;
      const w = window as unknown as { __slowSettled: boolean };
      w.__slowSettled = false;
      const settled = () => void (w.__slowSettled = true);
      const fetch0 = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (url.pathname !== "/api/diagrams/slow.json") return fetch0(input, init);
        let res: Response;
        try {
          res = await fetch0(input, init);
        } catch (e) {
          settled();
          throw e;
        }
        if (!res.body) {
          settled();
          return res;
        }
        const body = res.body.pipeThrough(new TransformStream({ flush: settled }));
        return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
      };
    });
    const host = await emptyHost(page, servers, baseURL ?? "", `src-json="/api/diagrams/slow.json"`);
    // The fetch is held; the host supplies a newer diagram meanwhile.
    expect(await loadVia(page, [titled("Newer")])).toEqual(["loaded:Newer"]);
    // What the viewer hears from here on.
    const frame = await embedFrame(page);
    await frame.evaluate((protocol) => {
      const w = window as unknown as { __heard: string[] };
      w.__heard = [];
      window.addEventListener("message", (e: MessageEvent<{ protocol?: string; type?: string }>) => {
        if (e.data?.protocol === protocol) w.__heard.push(String(e.data.type));
      });
    }, PROTOCOL);
    host.release();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __slowSettled: boolean }).__slowSettled))
      .toBe(true);
    // Then a command: the viewer hears it and nothing before it (the stale diagram, had it been sent, would be).
    await call(page, "fit");
    await expect
      .poll(() => frame.evaluate(() => (window as unknown as { __heard: string[] }).__heard))
      .toEqual(["fit"]);
    await expect(view(page).getByTestId("diagram-title")).toHaveText("Newer");
    expect((await events(page, "loaded")).map((e) => e.detail.title)).toEqual(["Newer"]);

    // 40 MB streamed: the page gives up past 8 MB and hangs up, long before the end.
    await el(page).evaluate((node) => node.setAttribute("src-json", "/api/diagrams/huge.json"));
    await expect.poll(() => lastEvent(page, "error")).toMatchObject({ code: "too_large" });
    await expect.poll(() => host.huge.closedEarly).toBe(true);
    expect(host.huge.sent).toBeLessThan(30);
    await expect(view(page).getByTestId("diagram-title")).toHaveText("Newer");
    expectNoErrors(consoleErrors);
  });

  test("Enter or Space on a focused node reports it, like a click", async ({ page, baseURL, servers }) => {
    await emptyHost(page, servers, baseURL ?? "");
    expect(await loadVia(page, [titled("Keys")])).toEqual(["loaded:Keys"]);
    // The node itself is the Tab stop (React Flow's wrapper round the test id).
    await view(page)
      .getByTestId("node-orders")
      .evaluate((n) => n.closest<HTMLElement>("[data-id]")?.focus());
    await page.keyboard.press("Enter");
    await expect.poll(() => lastEvent(page, "nodeclick")).toEqual({ nodeId: "orders", label: "Order service" });
    await view(page)
      .getByTestId("node-payments")
      .evaluate((n) => n.closest<HTMLElement>("[data-id]")?.focus());
    await page.keyboard.press("Space");
    await expect.poll(() => lastEvent(page, "nodeclick")).toMatchObject({ nodeId: "payments" });
  });
});

test.describe("embed dialog: your app supplies the diagram", () => {
  test("offers the private embed with copyable code and a preview fed by postMessage", async ({
    page,
    context,
    consoleErrors,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("./?view=canvas&example=kafka-order-pipeline");
    await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
    // Share… ▸ Embed in your app: the host-supplied embed only, with no source that puts the diagram in a URL.
    await shareVia(page, "embed");
    const dialog = page.getByTestId("embed-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("embed-source-inline")).toHaveCount(0);
    await expect(page.getByTestId("embed-host-note")).toContainText(
      "The diagram never leaves your app. Live Diagrams only provides the viewer.",
    );
    const snippet = page.getByTestId("embed-snippet");
    await expect(snippet).toHaveValue(/<script type="module" src="[^"]+\/embed\/live-diagram\.js"><\/script>/);
    await expect(snippet).toHaveValue(/<live-diagram src-json="\/diagrams\/kafka-order-pipeline\.diagram\.json"/);
    expect(await snippet.inputValue()).not.toMatch(/#[de]=/);
    // The preview is the same viewer, handed the diagram with postMessage: its URL holds none of it.
    const preview = page.getByTestId("embed-preview");
    expect(await preview.getAttribute("src")).toMatch(/\?embed=1&host=1&hostOrigin=/);
    expect(await preview.getAttribute("src")).not.toContain("#");
    await expect(preview.contentFrame().getByTestId("host-embed-view")).toHaveAttribute("data-status", "ready");
    await expect(preview.contentFrame().getByTestId("node-payments")).toBeVisible();

    // The code's radio group is one Tab stop; arrows move and select.
    await expect(page.getByTestId("embed-host-format-component")).toHaveAttribute("tabindex", "0");
    await expect(page.getByTestId("embed-host-format-iframe")).toHaveAttribute("tabindex", "-1");
    await page.getByTestId("embed-host-format-component").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("embed-host-format-iframe")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("embed-host-format-iframe")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("embed-host-format-component")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("embed-host-format-iframe").click();
    await expect(snippet).toHaveValue(/hostOrigin=" \+ encodeURIComponent\(location\.origin\)/);
    await expect(snippet).toHaveValue(/postMessage\(\{ protocol: PROTOCOL, type: "load", diagram/);
    await page.getByTestId("embed-copy").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("livediagrams.embed.v1");
    expectNoErrors(consoleErrors);
  });
});
