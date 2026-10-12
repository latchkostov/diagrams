import type { Page, Response } from "@playwright/test";
import { test, expect, E2E_TARGET, gotoLab, pageLoadTimeout } from "./fixtures";
import { installFakeSpeech, openAdvanced } from "./ai-helpers";

// The Content-Security-Policy and the other security headers (scripts/security-headers.ts), on the production
// build: `vite preview` sends exactly what vercel.json does. Each test walks part of the app and expects zero
// CSP violations (securitypolicyviolation events in every frame, and the console's "Refused to …" errors).
// The dev server sends no CSP, so these run only with E2E_TARGET=build (CI's default).
// Selectors are data-testid only.

test.skip(E2E_TARGET !== "build", "the CSP is sent by the production build's server only");

// Record video takes a real tab capture, accepted automatically (full Chromium's headless mode).
test.use({ channel: "chromium", launchOptions: { args: ["--auto-accept-this-tab-capture"] } });

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
    await page.keyboard.press("Control+k");
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
      };
    });
    expect(allowed).toEqual({ microphone: true, displayCapture: true, camera: true, geolocation: false });

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
    await expect(async () => {
      await page.getByTestId("node-shopper").click({ button: "right" });
      await page.getByTestId("context-menu-item-sim.slowmo-from").click({ timeout: 1000 });
    }).toPass({ timeout: 8000 });
    await expect(canvas).toHaveAttribute("data-slowmo", "playing");
    await page.keyboard.press("Escape");
    await expect(canvas).not.toHaveAttribute("data-slowmo", "playing");

    // Record a couple of seconds (real tab capture and MediaRecorder), then play it back from a blob: URL.
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-record").click();
    await page.getByTestId("record-start").click();
    await expect(page.getByTestId("record-elapsed")).toHaveText("0:01", { timeout: 10_000 });
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
    await page.getByTestId("file-button").click();
    await page.getByTestId("export-embed").click();
    const frame = page.getByTestId("embed-preview").contentFrame();
    await expect(frame.getByTestId("node-shopper")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("embed-dialog-close").click();

    // A password link: made, opened, unlocked (WebCrypto runs under the policy).
    await page.getByTestId("file-button").click();
    await page.getByTestId("export-share-link-password").click();
    await page.getByTestId("password-link-input").fill("plum orbit lantern 42");
    await page.getByTestId("password-link-copy").click();
    const link = await page.getByTestId("password-link-url").inputValue({ timeout: 15_000 });
    await page.goto(link);
    await page.getByTestId("password-prompt-input").fill("plum orbit lantern 42");
    await page.getByTestId("password-prompt-submit").click();
    await expect(page.getByTestId("shared-banner")).toBeVisible({ timeout: 15_000 });

    expect(await csp.violations()).toEqual([]);
  });

  test("the static pages: privacy, sign-in redirect, skill install page", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const csp = await watch(page);
    expectPolicy(await page.goto("./privacy.html"));
    await expect(page.getByTestId("privacy-title")).toBeVisible();

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
