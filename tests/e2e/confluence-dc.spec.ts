import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect, pauseClock } from "./fixtures";
import { selfHostHeadersFor } from "../../scripts/self-host-headers";
import { textFieldsFixture } from "../../src/lab/textFieldsFixture";

const recipe = "deploy/self-host/confluence-dc/";
const attachment = "/confluence/download/attachments/12345/order-flow.livediagram.json";
const marker = "MACROONLY7831";
const diagram = { ...textFieldsFixture, private: true, title: `Order "flow" <overview> & ${marker}` };
const scripted = {
  ...diagram,
  simulations: [{ id: "order-flow", title: "Order flow", durationMs: 60_000, traffic: [] }],
};
const encode = (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

// Only stand in for Velocity's documented parameter substitutions; serve the recipe's actual markup and JS.
function macro(viewer: string, source: string, clickToPlay: boolean) {
  const template = readFileSync(`${recipe}live-diagram.vm`, "utf8");
  return template
    .slice(template.indexOf("<script"))
    .replace("https://diagrams.example.com/", `${viewer}/`)
    .replace("$htmlUtil.htmlEncode($paramsource)", encode(source))
    .replace("$htmlUtil.htmlEncode($height)", "520")
    .replace("$clickToPlay", String(clickToPlay));
}

for (const source of ["attachment", "inline"] as const) {
  test(`Confluence macro: ${source} with saved simulations plays the first simulation under framed headers`, async ({
    page,
  }, testInfo) => {
    const baseURL = testInfo.config.metadata.productionBaseURL as string;
    const requests: { url: string; body: string }[] = [];
    const cookies: string[] = [];
    let deferredFetches = 0;
    const violations: string[] = [];
    await page.clock.install();
    await page.exposeFunction("recordMacroCsp", (message: string) => violations.push(message));
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const spacer = document.querySelector<HTMLElement>('[data-testid="confluence-spacer"]');
        if (spacer) spacer.style.height = "10000px";
      });
      document.addEventListener("securitypolicyviolation", (event) => {
        void (window as unknown as { recordMacroCsp(s: string): Promise<void> }).recordMacroCsp(
          event.effectiveDirective,
        );
      });
    });
    let host = "";
    let viewer = "";
    const server = createServer((req, res) => {
      void (async () => {
        const path = new URL(req.url ?? "/", "http://host").pathname;
        const send = (type: string, body: string, status = 200) => {
          res.writeHead(status, { "Content-Type": type });
          res.end(body);
        };
        if (req.headers.host?.startsWith("127.0.0.1:")) {
          if (path === attachment.replace("order-flow", "deferred-flow")) {
            deferredFetches++;
            return send("application/json", JSON.stringify({ ...diagram, title: " " }));
          }
          if (path === attachment) {
            cookies.push(req.headers.cookie ?? "");
            return send(
              "application/json",
              JSON.stringify(scripted),
              req.headers.cookie?.includes("session=reader") ? 200 : 403,
            );
          }
          if (path !== "/") return send("text/plain", "Not found", 404);
          res.setHeader(
            "Content-Security-Policy",
            `default-src 'self'; script-src 'self' ${viewer}; frame-src ${viewer}; connect-src 'self'; object-src 'none'`,
          );
          const markup = macro(viewer, source === "inline" ? JSON.stringify(scripted) : attachment, true);
          const still = macro(viewer, JSON.stringify({ ...diagram, title: "Inventory overview" }), false);
          const offscreen = macro(viewer, attachment.replace("order-flow", "deferred-flow"), true);
          return send(
            "text/html",
            readFileSync("tests/fixtures/confluence-dc/host-page.template", "utf8").replace(
              "__MACROS__",
              markup + still + '<div data-testid="confluence-spacer"></div>' + offscreen,
            ),
          );
        }
        requests.push({ url: req.url ?? "", body: "" });
        for (const [key, value] of Object.entries(selfHostHeadersFor(req.url ?? "/", { frameAncestors: [host] })))
          res.setHeader(key, value);
        if (path === "/embed/confluence-dc.js")
          return send("text/javascript", readFileSync(`${recipe}confluence-dc.js`, "utf8"));
        const response = await fetch(new URL(req.url ?? "/", baseURL));
        res.writeHead(response.status, {
          "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
        });
        res.end(Buffer.from(await response.arrayBuffer()));
      })().catch(() => res.writeHead(500).end());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    host = `http://127.0.0.1:${port}`;
    viewer = `http://localhost:${port}`;
    try {
      await page.context().addCookies([{ name: "session", value: "reader", url: host }]);
      page.on("request", (req) => {
        if (new URL(req.url()).origin === viewer) requests.push({ url: req.url(), body: req.postData() ?? "" });
      });
      const frameResponse = page.waitForResponse((r) => r.url().startsWith(`${viewer}/?embed`));
      await page.goto(host);
      const csp = (await (await frameResponse).allHeaders())["content-security-policy"];
      expect(csp).toContain(`frame-ancestors 'self' ${host}`);
      const macros = page.getByTestId("confluence-diagram");
      await expect(macros).toHaveCount(3);
      for (const index of [0, 1]) {
        const view = macros.nth(index).getByTestId("live-diagram-frame").contentFrame();
        await expect(view.getByTestId("host-embed-view")).toHaveAttribute("data-status", "ready");
        await expect(view.getByTestId("node-a")).toBeVisible();
        await expect(view.getByTestId("host-embed-view")).not.toHaveAttribute("data-live", "1");
        await expect(macros.nth(index).getByTestId("confluence-viewer")).toHaveAttribute("height", "520");
        const url = new URL((await macros.nth(index).getByTestId("live-diagram-frame").getAttribute("src")) ?? "");
        expect(Object.fromEntries(url.searchParams)).toEqual({ embed: "1", host: "1", hostOrigin: host });
        expect(url.hash).toBe("");
        const title = index === 0 ? diagram.title : "Inventory overview";
        await expect(macros.nth(index).getByTestId("live-diagram-frame")).toHaveAttribute("title", title);
        if (index === 0)
          await expect(macros.nth(index).getByTestId("confluence-play")).toHaveAccessibleName(`Play diagram: ${title}`);
        else
          await expect(macros.nth(index).getByTestId("confluence-play")).toHaveAttribute(
            "aria-label",
            `Play diagram: ${title}`,
          );
      }
      // Off-screen macros create neither a viewer frame nor its React application until scrolled into view.
      await expect(macros.nth(2).getByTestId("live-diagram-frame")).toHaveCount(0);
      const deferredHeight = await macros.nth(2).evaluate((el) => el.getBoundingClientRect().height);
      expect(deferredFetches).toBe(0);
      // Suppress intersection activation: keyboard focus itself must initialize the deferred diagram.
      await macros
        .nth(2)
        .evaluate((el) => (el as HTMLElement & { observer: IntersectionObserver }).observer.disconnect());
      await macros.nth(2).focus();
      await expect(
        macros.nth(2).getByTestId("live-diagram-frame").contentFrame().getByTestId("host-embed-view"),
      ).toHaveAttribute("data-status", "ready");
      await expect(macros.nth(2).getByTestId("live-diagram-frame")).toHaveAttribute("title", "Untitled diagram");
      await expect(macros.nth(2).getByTestId("confluence-play")).toHaveAccessibleName("Play diagram: Untitled diagram");
      expect(await macros.nth(2).evaluate((el) => el.getBoundingClientRect().height)).toBe(deferredHeight);
      expect(deferredFetches).toBe(1);
      // A diagram without saved simulations still offers click-to-play (free play).
      const deferred = macros.nth(2).getByTestId("live-diagram-frame").contentFrame();
      await expect(deferred.getByTestId("host-embed-view")).not.toHaveAttribute("data-live", "1");
      await macros.nth(2).getByTestId("confluence-play").click();
      await expect(deferred.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
      await macros.nth(0).scrollIntoViewIfNeeded();
      await pauseClock(page);
      await page.clock.runFor(10_000);
      const first = macros.nth(0).getByTestId("live-diagram-frame").contentFrame();
      await expect(first.getByTestId("host-embed-view")).not.toHaveAttribute("data-live", "1");
      await expect(
        macros.nth(1).getByTestId("live-diagram-frame").contentFrame().getByTestId("host-embed-view"),
      ).not.toHaveAttribute("data-live", "1");
      await expect(macros.nth(1).getByTestId("confluence-play")).toBeHidden();
      await macros.nth(0).getByTestId("confluence-play").click();
      await expect(first.getByTestId("host-embed-view")).toHaveAttribute("data-live", "1");
      await expect(first.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
      await expect(first.getByTestId("live-sim-picker")).toHaveValue("order-flow");
      expect(cookies).toEqual(source === "attachment" ? ["session=reader"] : []);
      expect(JSON.stringify(requests)).not.toContain(marker);
      for (const req of requests) expect(req.url).not.toContain("/download/attachments/");
      expect(violations).toEqual([]);
      if (source === "attachment") {
        await page.context().clearCookies();
        await page.reload();
        await expect(macros.nth(0).getByTestId("confluence-error")).toContainText("Could not load diagram");
        await expect(macros.nth(0).getByTestId("confluence-play")).toBeDisabled();
        await expect(macros.nth(0).getByTestId("live-diagram-frame").contentFrame().getByTestId("node-a")).toHaveCount(
          0,
        );
      }
    } finally {
      await page.goto("about:blank");
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

test("Confluence macro: oversized inline JSON is rejected before parsing in the host", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("A viewer base URL is required.");
  await page.addInitScript(() => {
    const parse = JSON.parse;
    JSON.parse = (text, reviver) => {
      if (text.length > 8_000_000) throw new Error("Oversized input reached JSON.parse");
      return parse(text, reviver);
    };
  });
  await page.route("**/confluence-size-check", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: macro(baseURL, '{"title":"' + "x".repeat(8_000_000) + '"}', true),
    }),
  );
  await page.route("**/embed/confluence-dc.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: readFileSync(`${recipe}confluence-dc.js`, "utf8") }),
  );
  await page.goto(`${baseURL}/confluence-size-check`);
  await expect(page.getByTestId("confluence-error")).toContainText("The diagram is too large");
  await expect(page.getByTestId("confluence-play")).toBeDisabled();
});
