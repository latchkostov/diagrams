import type { Page } from "@playwright/test";
import { test, expect, expectNoErrors } from "./fixtures";

// Record video: the live view's "⋯ › Record video…" and canvas right-click. Real share prompts can't
// be automated, so getDisplayMedia is stubbed with a canvas stream (captureStream) and, in most
// tests, MediaRecorder with a fake that hands back a small WebM-typed blob. One test keeps the
// browser's real MediaRecorder to prove the whole pipeline writes a playable video with a length.
// Selectors are data-testid only.

const KAFKA = "kafka-order-pipeline";
const OUTAGE = "payments-outage";

interface StubOptions {
  /** "deny" rejects the share prompt like a refusal; "missing" removes getDisplayMedia. */
  prompt?: "grant" | "deny" | "missing";
  /** Keep the browser's own MediaRecorder instead of the fake. */
  realRecorder?: boolean;
}

async function stubCapture(page: Page, opts: StubOptions = {}) {
  await page.addInitScript((o: StubOptions) => {
    const w = window as unknown as Record<string, unknown> & { __rec: Record<string, unknown> };
    w.__rec = { requests: 0 };
    const fakeStream = () => {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 180;
      const ctx = c.getContext("2d");
      let f = 0;
      const draw = () => {
        if (!ctx) return;
        ctx.fillStyle = `hsl(${(f++ * 9) % 360} 70% 50%)`;
        ctx.fillRect(0, 0, 320, 180);
      };
      draw();
      setInterval(draw, 33);
      const stream = c.captureStream(30);
      // Behave like a captured tab that can be framed to an element.
      const track = stream.getVideoTracks()[0] as MediaStreamTrack & { restrictTo?: (t: unknown) => Promise<void> };
      track.restrictTo = async (target) => {
        w.__rec.framedTo = (target as { el: Element }).el.getAttribute("data-testid");
      };
      return stream;
    };
    w.RestrictionTarget = { fromElement: async (el: Element) => ({ el }) };
    if (o.prompt === "missing") {
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { value: undefined, configurable: true });
    } else {
      navigator.mediaDevices.getDisplayMedia = async (options?: DisplayMediaStreamOptions) => {
        w.__rec.requests = (w.__rec.requests as number) + 1;
        w.__rec.options = JSON.parse(JSON.stringify(options ?? {}));
        if (o.prompt === "deny") throw new DOMException("Permission denied", "NotAllowedError");
        return fakeStream();
      };
    }
    if (o.realRecorder) return;
    class FakeRecorder extends EventTarget {
      state: RecordingState = "inactive";
      mimeType: string;
      static isTypeSupported(mime: string) {
        return mime.startsWith("video/webm");
      }
      constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        super();
        this.mimeType = options?.mimeType ?? "video/webm";
        w.__rec.mime = this.mimeType;
      }
      start() {
        this.state = "recording";
        w.__rec.started = true;
      }
      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        const data = new Blob([new Uint8Array(48_000)], { type: this.mimeType });
        setTimeout(() => {
          this.dispatchEvent(Object.assign(new Event("dataavailable"), { data }));
          this.dispatchEvent(new Event("stop"));
        }, 30);
      }
    }
    w.MediaRecorder = FakeRecorder;
  }, opts);
}

const rec = (page: Page, key: string) =>
  page.evaluate((k) => (window as never as { __rec: Record<string, unknown> }).__rec[k], key);

async function openRecord(page: Page) {
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-record").click();
  await expect(page.getByTestId("record-setup")).toBeVisible();
}

test.describe("record video", () => {
  test("start → countdown → indicator → stop → review → download", async ({ page, consoleErrors }) => {
    await stubCapture(page);
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&sim=${OUTAGE}&paused=1`);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await openRecord(page);
    await page.getByTestId("record-opt-from-start").uncheck();
    await page.getByTestId("record-start").click();

    await expect(page.getByTestId("record-countdown")).toBeVisible();
    // The share prompt asked for this tab, without sound.
    expect(await rec(page, "options")).toMatchObject({ preferCurrentTab: true, audio: false });
    await expect(page.getByTestId("record-indicator")).toBeVisible({ timeout: 6_000 });
    await expect(page.getByTestId("record-countdown")).toHaveCount(0);
    await expect.poll(() => rec(page, "started")).toBe(true);
    // Framed to the canvas area, in presentation view, with the live bar and top bar out of the way.
    expect(await rec(page, "framedTo")).toBe("canvas-wrap");
    expect(await rec(page, "mime")).toBe("video/webm;codecs=vp9");
    await expect(page).toHaveURL(/present=1/);
    await expect(page.getByTestId("topbar")).toHaveCount(0);
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    await expect(page.getByTestId("record-elapsed")).toHaveText("0:01", { timeout: 4_000 });

    await page.getByTestId("record-stop").click();
    const review = page.getByTestId("record-review");
    await expect(review).toBeVisible();
    await expect(page.getByTestId("record-meta")).toContainText(/0:0\d · 48 KB · WebM \(VP9\)/);
    await expect(page.getByTestId("record-preview")).toBeVisible();
    // The chrome is back.
    await expect(page).not.toHaveURL(/present=1/);
    await expect(page.getByTestId("topbar")).toBeVisible();
    await expect(page.getByTestId("live-controls")).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("record-download").click()]);
    expect(download.suggestedFilename()).toBe("kafka-order-pipeline-payments-service-goes-down.webm");
    await expect(review).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("Esc stops; Discard can be undone; the canvas right-click offers Record too", async ({ page }) => {
    await stubCapture(page);
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    // An empty spot on the canvas (between the nodes and the live bar).
    await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: 600, y: 600 } });
    await page.getByTestId("context-menu-item-sim.record").click();
    await expect(page.getByTestId("record-setup")).toBeVisible();
    // Free play has nothing to play from the start.
    await expect(page.getByTestId("record-opt-from-start")).toHaveCount(0);
    await page.getByTestId("record-opt-present").uncheck();
    await page.getByTestId("record-start").click();
    await expect(page.getByTestId("record-indicator")).toBeVisible({ timeout: 6_000 });
    await expect(page).not.toHaveURL(/present=1/);
    // L doesn't leave live view mid-take; Esc stops the recording (and only that).
    await page.keyboard.press("l");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("record-review")).toBeVisible();
    await expect(page.getByTestId("live-controls")).toBeVisible();

    await page.getByTestId("record-discard").click();
    await expect(page.getByTestId("record-review")).toHaveCount(0);
    await page.getByTestId("record-discard-undo").click();
    await expect(page.getByTestId("record-review")).toBeVisible();
    await expect(page.getByTestId("record-meta")).toContainText("48 KB");
  });

  test("Esc during the countdown cancels without recording", async ({ page }) => {
    await stubCapture(page);
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await openRecord(page);
    await page.getByTestId("record-start").click();
    await expect(page.getByTestId("record-countdown")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("record-countdown")).toHaveCount(0);
    await expect(page.getByTestId("record-indicator")).toHaveCount(0);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page).not.toHaveURL(/present=1/);
    expect(await rec(page, "started")).toBeUndefined();
  });

  test("a refused share prompt explains itself and nothing breaks", async ({ page, consoleErrors }) => {
    await stubCapture(page, { prompt: "deny" });
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await openRecord(page);
    await page.getByTestId("record-start").click();
    await expect(page.getByTestId("record-error")).toContainText("wasn't allowed");
    await expect(page.getByTestId("record-start")).toBeEnabled();
    await page.getByTestId("record-cancel").click();
    await expect(page.getByTestId("record-setup")).toHaveCount(0);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page.getByTestId("topbar")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("a browser that can't capture says so and can't start", async ({ page }) => {
    await stubCapture(page, { prompt: "missing" });
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await openRecord(page);
    await expect(page.getByTestId("record-unsupported")).toContainText("can't record a tab");
    await expect(page.getByTestId("record-start")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("record-setup")).toHaveCount(0);
    await expect(page.getByTestId("live-controls")).toBeVisible();
  });

  test("from the start: the simulation restarts at 0:00 and the recording stops when it ends", async ({ page }) => {
    test.slow();
    await stubCapture(page);
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&sim=${OUTAGE}&speed=8`);
    await expect(page.getByTestId("live-clock")).not.toHaveAttribute("data-ms", "0");
    await openRecord(page);
    await expect(page.getByTestId("record-opt-from-start")).toBeChecked();
    await page.getByTestId("record-start").click();
    await expect(page.getByTestId("record-indicator")).toBeVisible({ timeout: 6_000 });
    // It ends by itself: the pausing note holds a few seconds, the run drains, the review opens.
    await expect(page.getByTestId("record-review")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("live-done")).toBeVisible();
  });

  test("the browser's real recorder writes a WebM that players can measure", async ({ page }) => {
    await stubCapture(page, { realRecorder: true });
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await openRecord(page);
    await page.getByTestId("record-start").click();
    await expect(page.getByTestId("record-elapsed")).toHaveText("0:02", { timeout: 8_000 });
    await page.getByTestId("record-stop").click();
    await expect(page.getByTestId("record-meta")).toContainText(/0:02 · \d+ KB · WebM/);
    // MediaRecorder leaves the length out; the review writes it in, so the preview knows it.
    const duration = await page.getByTestId("record-preview").evaluate(
      (v: HTMLVideoElement) =>
        new Promise<number>((resolve) => {
          if (v.readyState >= 1) resolve(v.duration);
          else v.addEventListener("loadedmetadata", () => resolve(v.duration), { once: true });
        }),
    );
    expect(Number.isFinite(duration)).toBe(true);
    expect(duration).toBeGreaterThan(1.5);
    expect(duration).toBeLessThan(4);
  });
});
