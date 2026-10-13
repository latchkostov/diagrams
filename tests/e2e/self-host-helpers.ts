import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

// Shared by self-host.spec.ts and self-host-locked.spec.ts: the embed dialog, and a host page that embeds a
// private diagram from the self-hosted build with <live-diagram> (docs/EMBEDDING.md). The host page is a real
// server on 127.0.0.1 (another origin than the app on localhost), like tests/e2e/host-embed.spec.ts's; the
// self-hosting preview servers let http://127.0.0.1:* frame embeds (playwright.config.ts).

const fixtures = join(process.cwd(), "tests", "fixtures", "host-embed");
const fixture = (name: string) => readFileSync(join(fixtures, name), "utf8");

/**
 * File ▸ Share… in a copy without share links: the two files and Embed in your app, safest first, and nothing else:
 * no Link with password…, no public section, and no line about links (there are none to explain). Its embed offers
 * only "Your app supplies it (private)": no source puts the diagram in a URL.
 */
export async function expectShareWithoutLinks(page: Page) {
  await page.getByTestId("file-button").click();
  await expect(page.getByTestId("file-share")).toContainText("Files, or an embed your app supplies");
  await page.getByTestId("file-share").click();
  await expect(page.getByTestId("share-chooser")).toBeVisible();
  await expect(page.getByTestId("share-option-html")).toBeFocused();
  for (const id of ["share-option-html", "share-option-file", "share-option-embed"])
    await expect(page.getByTestId(id)).toBeVisible();
  for (const id of [
    "share-option-password",
    "share-public-toggle",
    "share-option-link",
    "share-option-embed-public",
    "share-private-note",
  ])
    await expect(page.getByTestId(id)).toHaveCount(0);
  await page.getByTestId("share-option-embed").click();
  await expect(page.getByTestId("embed-dialog")).toBeVisible();
  await expect(page.getByTestId("embed-source-inline")).toHaveCount(0);
  await expect(page.getByTestId("embed-source-example")).toHaveCount(0);
  await expect(page.getByTestId("embed-host-note")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("embed-dialog")).toHaveCount(0);
}

/**
 * Serves a host page that loads `<live-diagram>` from the app at `appBase` and supplies `diagram` from its own
 * server. Returns its origin and a function that stops it.
 */
export async function serveHostPage(
  appBase: string,
  diagram: object,
): Promise<{ origin: string; close(): Promise<void> }> {
  const html = fixture("host-page.template")
    .replaceAll("__APP__", appBase)
    .replace("__ATTRS__", 'src-json="/api/diagrams/orders.diagram.json"');
  const send = (res: import("node:http").ServerResponse, type: string, body: string) => {
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  };
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://host").pathname;
    if (path === "/") return send(res, "text/html", html);
    if (path === "/host.js") return send(res, "text/javascript", fixture("host.js"));
    if (path === "/host.css") return send(res, "text/css", fixture("host.css"));
    if (path === "/api/diagrams/orders.diagram.json") return send(res, "application/json", JSON.stringify(diagram));
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** The host page shows the supplied diagram in the viewer frame (inside the element's shadow root). */
export async function expectHostEmbed(page: Page, origin: string, nodeId: string) {
  const res = await page.goto(`${origin}/`);
  expect(res?.ok()).toBe(true);
  const view = page.getByTestId("live-diagram-frame").contentFrame();
  await expect(view.getByTestId("host-embed-view")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(view.getByTestId(`node-${nodeId}`)).toBeVisible();
}
