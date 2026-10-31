import { openDiagramProperties } from "./fixtures";
import { waitForStableViewport } from "./fixtures";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { Page, Response } from "@playwright/test";
import { expect, STORAGE_KEYS, E2E_TARGET, gotoLab, pageLoadTimeout, shareVia } from "./fixtures";
import { captureTest as test } from "./capture-browser";
import { installFakeSpeech, openAdvanced } from "./ai-helpers";
import { recordFor } from "./recording-clock";
import { emulateTracker } from "./collab-tracker";
import { COLLAB_TRACKERS } from "../../src/collab/transport/tracker";
import { contentSecurityPolicy } from "../../scripts/security-headers";

// The Content-Security-Policy and the other security headers (scripts/security-headers.ts), on the production
// build: `vite preview` sends exactly what vercel.json does. Each test walks part of the app and expects zero
// CSP violations (securitypolicyviolation events in every frame, and the console's "Refused to …" errors).
// The dev server sends no CSP, so these run only with E2E_TARGET=build (CI's default).
// Selectors are data-testid only.

test.skip(E2E_TARGET !== "build", "the CSP is sent by the production build's server only");

const KAFKA = "kafka-order-pipeline";

declare global {
  interface Window {
    __csp?: string[];
  }
}

/** Starts collecting violations in every frame of `page`, and the console's CSP and Permissions-Policy errors. */
async function watch(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = (window.__csp = []);
    document.addEventListener("securitypolicyviolation", (e) =>
      seen.push(
        `${e.effectiveDirective} blocked ${e.blockedURI || "(inline)"} at ${e.sourceFile}:${e.lineNumber} ${e.sample}`,
      ),
    );
  });
  const console: string[] = [];
  page.on("console", (m) => {
    const text = m.text();
    if (/Content Security Policy|Refused to|Permissions[- ]Policy|Unrecognized feature/i.test(text))
      console.push(`${m.type()}: ${text}`);
  });
  return {
    async violations() {
      const found = [...console];
      for (const frame of page.frames())
        found.push(...((await frame.evaluate(() => window.__csp ?? []).catch(() => [])) as string[]));
      return found;
    },
  };
}

function expectPolicy(res: Response | null, embed = false) {
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp, "the server sent no Content-Security-Policy").toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-eval");
  expect(csp).toContain(embed ? "frame-ancestors *" : "frame-ancestors 'self'");
  expect(res?.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res?.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(res?.headers()["permissions-policy"]).toContain("microphone=(self)");
}

test.describe("Content-Security-Policy", () => {
  test("editor, AI panel with dictation, PNG and SVG export", async ({ page }) => {
    test.slow();
    const csp = await watch(page);
    await installFakeSpeech(page);
    const res = await page.goto(`./?view=canvas&example=${KAFKA}`);
    expectPolicy(res);
    expect(res?.headers()["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
    await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
    // public/theme.js ran (it was an inline script).
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");

    // Editing: select, right-click, Ctrl+K.
    await page.getByTestId("node-shopper").click();
    await page.getByTestId("node-shopper").click({ button: "right" });
    await expect(page.getByTestId("context-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.press("Escape");

    // The AI panel and dictation (a fake SpeechRecognition; the policy must still allow the microphone).
    await openAdvanced(page);
    await page.getByTestId("ai-mic").click();
    await expect(page.getByTestId("ai-mic")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ai-mic").click();
    const allowed = await page.evaluate(() => {
      const d = document as Document & { featurePolicy?: { allowsFeature(f: string): boolean } };
      return {
        microphone: d.featurePolicy?.allowsFeature("microphone"),
        displayCapture: d.featurePolicy?.allowsFeature("display-capture"),
        camera: d.featurePolicy?.allowsFeature("camera"),
        geolocation: d.featurePolicy?.allowsFeature("geolocation"),
        fullscreen: d.featurePolicy?.allowsFeature("fullscreen"),
      };
    });
    expect(allowed).toEqual({
      microphone: true,
      displayCapture: true,
      camera: true,
      geolocation: false,
      fullscreen: true,
    });

    // PNG, then SVG (html-to-image: fonts and icons inlined as data: URLs, rendered through blob: and data:).
    await page.getByTestId("file-button").click();
    const [png] = await Promise.all([
      page.waitForEvent("download", { timeout: 45_000 }),
      page.getByTestId("export-png").click(),
    ]);
    expect(png.suggestedFilename()).toMatch(/\.png$/);
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-image").click();
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    const [svg] = await Promise.all([
      page.waitForEvent("download", { timeout: 45_000 }),
      page.getByTestId("image-export").click(),
    ]);
    expect(svg.suggestedFilename()).toMatch(/\.svg$/);

    expect(await csp.violations()).toEqual([]);
  });

  test("live view on the particle worker, slow motion, and a recorded video", async ({ page }) => {
    test.slow();
    await page.clock.install();
    const csp = await watch(page);
    const res = await page.goto(`./?view=canvas&example=${KAFKA}&live=1`);
    expectPolicy(res);
    await expect(page.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
    const canvas = page.getByTestId("live-canvas");
    // A worker blocked by worker-src would fall back to the main thread: it must be the worker.
    await expect(canvas).toHaveAttribute("data-renderer", "worker");
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-particles")), { timeout: 10_000 })
      .toBeGreaterThan(20);

    // Slow motion from the storefront, then back to live.
    await waitForStableViewport(page);
    await page.getByTestId("node-shopper").click({ button: "right" });
    await page.getByTestId("context-menu-item-sim.slowmo-from").click();
    await expect(canvas).toHaveAttribute("data-slowmo", "playing");
    await page.keyboard.press("Escape");
    await expect(canvas).not.toHaveAttribute("data-slowmo", "playing");

    // Record a couple of seconds (real tab capture and MediaRecorder), then play it back from a blob: URL.
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-record").click();
    await recordFor(page, 1);
    await expect(page.getByTestId("record-elapsed")).toHaveText("0:01");
    await page.getByTestId("record-stop").click();
    const preview = page.getByTestId("record-preview");
    await expect(preview).toBeVisible();
    expect(await preview.getAttribute("src")).toMatch(/^blob:/);
    const ready = await preview.evaluate(
      (v: HTMLVideoElement) =>
        new Promise<boolean>((resolve) => {
          if (v.readyState >= 1) resolve(true);
          v.addEventListener("loadedmetadata", () => resolve(true), { once: true });
          v.addEventListener("error", () => resolve(false), { once: true });
        }),
    );
    expect(ready, "the recorded video didn't load (media-src)").toBe(true);

    expect(await csp.violations()).toEqual([]);
  });

  test("presenting full screen", async ({ page }) => {
    const csp = await watch(page);
    expectPolicy(await page.goto(`./?view=canvas&example=${KAFKA}&present=1`));
    // Full screen is the default allowlist's 'self': the policy doesn't need to name it.
    await page.getByTestId("present-fullscreen").click({ timeout: pageLoadTimeout() });
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
    await page.getByTestId("present-exit").click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    expect(await csp.violations()).toEqual([]);
  });

  test("Lab, embeds (direct and the embed dialog's preview) and a password link", async ({ page, context }) => {
    test.slow();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const csp = await watch(page);
    await gotoLab(page);

    const embed = await page.goto(`./?embed=1&example=${KAFKA}`);
    expectPolicy(embed, true);
    await expect(page.getByTestId("node-shopper")).toBeVisible({ timeout: pageLoadTimeout() });

    // The embed dialog previews the viewer in an iframe of this site (frame-src 'self').
    await page.goto(`./?view=canvas&example=${KAFKA}`);
    await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
    await shareVia(page, "embed-public");
    const frame = page.getByTestId("embed-preview").contentFrame();
    await expect(frame.getByTestId("node-shopper")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("embed-dialog-close").click();

    // A password link: made, opened, unlocked (WebCrypto runs under the policy).
    await shareVia(page, "password");
    await page.getByTestId("password-link-input").fill("plum orbit lantern 42");
    await page.getByTestId("password-link-copy").click();
    const link = await page.getByTestId("password-link-url").inputValue({ timeout: 15_000 });
    await page.goto(link);
    await page.getByTestId("password-prompt-input").fill("plum orbit lantern 42");
    await page.getByTestId("password-prompt-submit").click();
    await expect(page.getByTestId("shared-banner")).toBeVisible({ timeout: 15_000 });

    expect(await csp.violations()).toEqual([]);
  });

  test("Interactive HTML with a password: the template fetched and the file encrypted under the policy", async ({
    page,
  }) => {
    const csp = await watch(page);
    await page.goto(`./?view=canvas&example=${KAFKA}`);
    await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-html").click();
    await page.getByTestId("html-export-password-toggle").check();
    await page.getByTestId("html-export-password-input").fill("plum orbit lantern 42");
    const [file] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      page.getByTestId("html-export-download").click(),
    ]);
    expect(file.suggestedFilename()).toMatch(/^Diagram \(password protected\) [a-z2-9]{5}\.html$/);
    expect(await csp.violations()).toEqual([]);
  });

  test("the Permissions-Policy names only features this browser knows: no 'Unrecognized feature' warning", async ({
    page,
  }) => {
    // Listening from before the navigation: the browser reports a bad header while it parses it.
    const messages: string[] = [];
    page.on("console", (m) => messages.push(`${m.type()}: ${m.text()}`));
    const res = await page.goto(`./?view=canvas&example=${KAFKA}`);
    await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
    const header = res?.headers()["permissions-policy"] ?? "";
    const named = header.split(",").map((p) => p.trim().split("=")[0]);
    expect(named.length).toBeGreaterThan(3);
    const known = await page.evaluate(() => {
      const d = document as Document & { featurePolicy?: { features(): string[] } };
      return d.featurePolicy?.features() ?? [];
    });
    expect(known.length, "document.featurePolicy.features() is empty").toBeGreaterThan(0);
    for (const feature of named) expect(known, `${feature} isn't a feature this Chromium knows`).toContain(feature);
    expect(messages.filter((m) => /Permissions[- ]Policy|Unrecognized feature/i.test(m))).toEqual([]);
  });

  test("Confluence documentation and privacy links work on the production static site", async ({ page }) => {
    const csp = await watch(page);
    const documentation = await page.goto("./confluence.html");
    expect(documentation?.status()).toBe(200);
    expectPolicy(documentation);
    await expect(page.getByTestId("confluence-title")).toHaveText("Live Diagram for Confluence");
    await expect(page.getByTestId("confluence-marketplace-status")).toContainText("coming soon");
    await expect(page.getByTestId("confluence-steps")).toContainText(".diagram.json");
    await expect(page.getByTestId("confluence-support")).toHaveAttribute(
      "href",
      "https://github.com/latchkostov/diagrams/issues/new?template=confluence-app.yml",
    );
    await expect(page.getByTestId("confluence-support-guidance")).toContainText(
      "Never attach private or work diagrams.",
    );
    await page.getByTestId("confluence-privacy").click();
    await expect(page.getByTestId("privacy-confluence-title")).toHaveText("Live Diagram for Confluence");
    await expect(page.getByTestId("privacy-confluence")).toContainText("write:confluence-file");
    await page.getByTestId("privacy-confluence-docs").click();
    await expect(page.getByTestId("confluence-title")).toBeVisible();
    await page.getByTestId("confluence-terms").click();
    await expect(page.getByTestId("terms-title")).toBeVisible();
    expect(await csp.violations()).toEqual([]);
  });

  test("the static pages: privacy, terms, sign-in redirect, skill install page", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const csp = await watch(page);
    expectPolicy(await page.goto("./privacy.html"));
    await expect(page.getByTestId("privacy-title")).toBeVisible();
    expectPolicy(await page.goto("./terms.html"));
    await expect(page.getByTestId("terms-title")).toBeVisible();

    // auth.html's script is a file now: with nothing to hand back, it says so.
    const auth = await page.goto("./auth.html");
    expectPolicy(auth);
    expect(auth?.headers()["cross-origin-opener-policy"]).toBeUndefined();
    await expect(page.getByTestId("auth-message")).toHaveText(/Nothing to do here/);

    expectPolicy(await page.goto("./skill/"));
    await page.getByTestId("skill-copy-install").click();
    await expect(page.getByTestId("skill-copy-install")).toHaveText("Copied");

    expect(await csp.violations()).toEqual([]);
  });

  test("a docker-compose import (the YAML reader's chunk) and its Import report", async ({ page }) => {
    const csp = await watch(page);
    const res = await page.goto(`./?view=canvas&example=${KAFKA}`);
    expectPolicy(res);
    await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
    await page.getByTestId("import-input").setInputFiles({
      name: "docker-compose.yml",
      mimeType: "application/yaml",
      buffer: readFileSync(join(process.cwd(), "tests", "fixtures", "imports", "compose", "docker-compose.yml")),
    });
    await expect(page.getByTestId("diagram-title")).toHaveText("shop");
    await page.getByTestId("toast-import-details").click();
    await expect(page.getByTestId("import-report")).toBeVisible();
    await page.getByTestId("import-report-chip-1-generic.external-api").click();
    await page.getByTestId("import-report-done").click();
    expect(await csp.violations()).toEqual([]);
  });

  test("Edit together: two browsers meet through the approved trackers under the real policy", async ({
    browser,
    context,
    page,
  }) => {
    // The trackers are the approved public URLs, answered here (nothing leaves the machine) by routeWebSocket, which
    // replaces those sockets before the browser's CSP check: this checks the headers and the room under them, and the
    // test after it checks that native sockets obey the same tracker source. STUN isn't a fetch; the peers connect
    // over host candidates.
    test.slow();
    const other = await browser.newContext();
    try {
      const tracker = await emulateTracker([context, other], { trackers: COLLAB_TRACKERS });
      const csp = await watch(page);
      const res = await page.goto(`./?view=canvas&example=${KAFKA}`);
      expectPolicy(res);
      const connect = (res?.headers()["content-security-policy"] ?? "")
        .split("; ")
        .find((d) => d.startsWith("connect-src "))
        ?.split(" ")
        .filter((src) => /^wss?:/.test(src));
      expect(connect).toEqual([...COLLAB_TRACKERS]);
      await expect(page.getByTestId("node-orders")).toBeVisible({ timeout: pageLoadTimeout() });
      await shareVia(page, "edit-together");
      await page.getByTestId("room-start-confirm").click();
      const link = await page.getByTestId("room-link").inputValue();
      await page.getByTestId("room-started-done").click();
      const guest = await other.newPage();
      const guestCsp = await watch(guest);
      await guest.goto(link);
      await guest.getByTestId("room-join-accept").click();
      // Knock-to-join: the host lets them in.
      await page.getByTestId("room-knock-admit").first().click({ timeout: pageLoadTimeout() });
      await expect(guest.getByTestId("node-orders")).toBeVisible({ timeout: pageLoadTimeout() });
      await expect(page.getByTestId("room-chip")).toHaveAttribute("data-peers", "1");
      expect(tracker.opened).toBeGreaterThanOrEqual(2 * COLLAB_TRACKERS.length);
      expect(await csp.violations()).toEqual([]);
      expect(await guestCsp.violations()).toEqual([]);
      // Any other tracker (not routed, so checked natively) is refused: the list is exact.
      await page.evaluate(() => void new WebSocket("wss://tracker.btorrent.xyz"));
      await expect
        .poll(async () => (await csp.violations()).join("\n"))
        .toMatch(/connect-src blocked wss:\/\/tracker\.btorrent\.xyz/);
    } finally {
      await other.close();
    }
  });

  test("native tracker sockets obey connect-src: the tracker source admits a handshake, its absence blocks it", async ({
    page,
  }) => {
    // The test above answers the trackers inside the browser (routeWebSocket), which skips the browser's own CSP
    // check for those sockets. Here nothing is emulated: a page served with the app's policy, a real WebSocket
    // server on another origin, and the policy's tracker source built the same way (cspDirectives' `collab`).
    const listen = (server: Server) =>
      new Promise<number>((done) => server.listen(0, "127.0.0.1", () => done((server.address() as AddressInfo).port)));
    let handshakes = 0;
    const tracker = createServer();
    tracker.on("upgrade", (req, socket) => {
      handshakes++;
      const accept = createHash("sha1")
        .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
    });
    const trackerUrl = `ws://127.0.0.1:${await listen(tracker)}/announce`;
    let policy = "";
    const site = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": policy });
      res.end("<!doctype html><title>tracker socket</title>");
    });
    const origin = `http://127.0.0.1:${await listen(site)}`;
    try {
      const open = async () => {
        await page.goto(origin);
        return page.evaluate(
          (url) =>
            new Promise<string>((done) => {
              const violations: string[] = [];
              document.addEventListener("securitypolicyviolation", (e) => violations.push(e.effectiveDirective));
              try {
                const ws = new WebSocket(url);
                ws.onopen = () => done("open");
                ws.onerror = () => setTimeout(() => done(`error ${violations.join(",")}`), 100);
              } catch {
                done(`refused ${violations.join(",")}`);
              }
            }),
          trackerUrl,
        );
      };
      policy = contentSecurityPolicy({ embed: false, collab: [trackerUrl] });
      expect(policy).toContain(`connect-src 'self'`);
      expect(await open()).toBe("open");
      expect(handshakes).toBe(1);
      // The same policy without the tracker (a build without rooms, or an embed): blocked before any handshake.
      for (const without of [
        contentSecurityPolicy({ embed: false }),
        contentSecurityPolicy({ embed: true, collab: [trackerUrl] }),
      ]) {
        policy = without;
        expect(await open()).toMatch(/connect-src/);
      }
      expect(handshakes).toBe(1);
    } finally {
      tracker.close();
      site.close();
    }
  });

  test("the policy is enforced, and the watcher sees it: injected code and outside requests are blocked", async ({
    page,
  }) => {
    const csp = await watch(page);
    await page.goto(`./?view=canvas&example=${KAFKA}`);
    await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
    const outcome = await page.evaluate(async () => {
      const w = window as Window & { __ran?: boolean };
      const s = document.createElement("script");
      s.textContent = "window.__ran = true";
      document.body.append(s);
      const fetched = await fetch("https://example.com/collect").then(
        () => true,
        () => false,
      );
      return { inline: !!w.__ran, fetched };
    });
    // (eval can't be checked from here: DevTools' own evaluation is exempt. The unit test checks the header.)
    expect(outcome).toEqual({ inline: false, fetched: false });
    await expect.poll(async () => (await csp.violations()).join("\n")).toMatch(/script-src-elem/);
    const found = (await csp.violations()).join("\n");
    expect(found).toMatch(/connect-src blocked https:\/\/example\.com/);
  });
});

test("Markdown images respect production CSP", async ({ page }) => {
  const csp = await watch(page);
  await page.addInitScript(
    ([key, diagram]) => localStorage.setItem(key, diagram),
    [
      STORAGE_KEYS.autosavePrefix + KAFKA,
      JSON.stringify({
        format: "diagrams/v1",
        title: "Image policy",
        description:
          "![Local](/favicon.svg) ![Embedded](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='8'%20height='8'%3E%3C/svg%3E) ![External](https://example.com/architecture.png)",
        nodes: [{ id: "api", stencil: "service.go", label: "API", x: 0, y: 200 }],
        edges: [],
      }),
    ],
  );
  expectPolicy(await page.goto(`./?view=canvas&example=${KAFKA}`));
  await openDiagramProperties(page);
  const images = page.getByTestId("diagram-description").getByTestId("markdown-image");
  await expect(images).toHaveCount(2);
  const image = images.nth(0);
  await expect(image).toHaveAttribute("alt", "Local");
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  await expect
    .poll(() => images.nth(1).evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
  const fallback = page.getByTestId("diagram-description").getByTestId("markdown-image-fallback");
  await expect(fallback).toHaveText("External");
  await expect(fallback).toHaveAttribute("href", "https://example.com/architecture.png");
  expect(await csp.violations()).toEqual([]);
});
