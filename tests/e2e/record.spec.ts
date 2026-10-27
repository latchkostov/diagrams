import { test, expect, expectNoErrors, gotoLive, pauseClock } from "./fixtures";
import type { Page } from "@playwright/test";
import { recordFor } from "./recording-clock";

// Record video: the live view's "⋯ › Record video…" and canvas right-click. Real share prompts can't
// be automated, so getDisplayMedia is stubbed with a canvas stream (captureStream) and, in most
// tests, MediaRecorder with a fake that hands back a small WebM-typed blob. One test keeps the
// browser's real MediaRecorder to prove the whole pipeline writes a playable video with a length.
// Selectors are data-testid only.

const KAFKA = "kafka-order-pipeline";
const OUTAGE = "payments-outage";

interface StubOptions {
  /** "deny" rejects the share prompt like a refusal; "missing" removes getDisplayMedia. */
  prompt?: "grant" | "deny" | "missing" | "pending";
  frame?: "fail" | "pending";
  /** Keep the browser's own MediaRecorder instead of the fake. */
  realRecorder?: boolean;
}

async function stubCapture(page: Page, opts: StubOptions = {}) {
  await page.addInitScript((o: StubOptions) => {
    const w = window as unknown as Record<string, unknown> & { __rec: Record<string, unknown> };
    w.__rec = { requests: 0, stopped: 0, created: 0, starts: 0, revoked: [] };
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      (w.__rec.revoked as string[]).push(url);
      revoke(url);
    };
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
      const stop = track.stop.bind(track);
      track.stop = () => {
        w.__rec.stopped = (w.__rec.stopped as number) + 1;
        stop();
      };
      w.__rec.endTrack = () => track.dispatchEvent(new Event("ended"));
      w.__rec.failTrack = () => track.dispatchEvent(new Event("error"));
      track.restrictTo = async (target) => {
        if (o.frame === "fail") throw new Error("Crop failed");
        if (o.frame === "pending") w.__rec.framing = true;
        if (o.frame === "pending")
          await new Promise<void>((resolve) => {
            w.__rec.resolveFrame = resolve;
          });
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
        if (o.prompt === "pending")
          return new Promise<MediaStream>((resolve) => {
            w.__rec.grant = () => resolve(fakeStream());
          });
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
        w.__rec.created = (w.__rec.created as number) + 1;
        w.__rec.failEncoder = () => {
          this.state = "inactive";
          this.dispatchEvent(Object.assign(new Event("error"), { error: new Error("Encoder failed") }));
        };
      }
      start() {
        this.state = "recording";
        w.__rec.started = true;
        w.__rec.starts = (w.__rec.starts as number) + 1;
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
  test("a late permission grant after unmount stops capture without framing or recording", async ({
    page,
    consoleErrors,
  }) => {
    await stubCapture(page, { prompt: "pending" });
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await openRecord(page);
    await page.getByTestId("record-start").click();
    await page.evaluate(() => {
      history.pushState(null, "", "?view=gallery");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.getByTestId("record-setup")).toHaveCount(0);
    await page.evaluate(() => (window as never as { __rec: { grant: () => void } }).__rec.grant());
    await expect.poll(() => rec(page, "stopped")).toBe(1);
    expect(await rec(page, "created")).toBe(0);
    expect(await rec(page, "framedTo")).toBeUndefined();
    await expect(page).not.toHaveURL(/present=1/);
    expectNoErrors(consoleErrors);
  });

  test("cancellation during asynchronous framing cannot create a recorder", async ({ page, consoleErrors }) => {
    await stubCapture(page, { frame: "pending" });
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await openRecord(page);
    await page.getByTestId("record-start").click();
    await expect.poll(() => rec(page, "framing")).toBeTruthy();
    await page.keyboard.press("Escape");
    await page.evaluate(() => (window as never as { __rec: { resolveFrame: () => void } }).__rec.resolveFrame());
    await expect.poll(() => rec(page, "framedTo")).toBe("app");
    expect(await rec(page, "created")).toBe(0);
    expect(await rec(page, "stopped")).toBeGreaterThan(0);
    await expect(page.getByTestId("record-countdown")).toHaveCount(0);
    await expect(page).not.toHaveURL(/present=1/);
    expectNoErrors(consoleErrors);
  });

  for (const failure of ["failEncoder", "failTrack"] as const) {
    test(`${failure}: failure stops capture and permits retry`, async ({ page, consoleErrors }) => {
      await stubCapture(page);
      await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
      await openRecord(page);
      await page.getByTestId("record-start").click();
      await expect.poll(() => rec(page, "started"), { timeout: 6000 }).toBe(true);
      await page.evaluate((key) => (window as never as { __rec: Record<string, () => void> }).__rec[key](), failure);
      await expect(page.getByTestId("record-error")).toContainText(/Recording failed/);
      await expect(page.getByTestId("record-indicator")).toHaveCount(0);
      await expect(page).not.toHaveURL(/present=1/);
      await expect.poll(() => rec(page, "stopped")).toBeGreaterThan(0);
      await expect(page.getByTestId("record-start")).toBeEnabled();
      await page.getByTestId("record-start").click();
      await expect(page.getByTestId("record-countdown")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("live-controls")).toBeVisible();
      expectNoErrors(consoleErrors);
    });
  }

  test("failed cropping discloses whole-surface capture before countdown, with Cancel or Continue", async ({
    page,
    consoleErrors,
  }) => {
    await stubCapture(page, { frame: "fail" });
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await openRecord(page);
    await page.getByTestId("record-start").click();
    await expect(page.getByTestId("record-scope")).toContainText("everything you shared");
    await expect(page.getByTestId("record-countdown")).toHaveCount(0);
    expect(await rec(page, "created")).toBe(0);
    await page.getByTestId("record-scope-cancel").click();
    await expect.poll(() => rec(page, "stopped")).toBe(1);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await openRecord(page);
    await page.getByTestId("record-start").click();
    await page.getByTestId("record-scope-continue").click();
    await expect(page.getByTestId("record-countdown")).toBeVisible();
    await page.keyboard.press("Escape");
    expectNoErrors(consoleErrors);
  });

  test("successive discards release both video URLs and Undo restores only its own clip", async ({ page }) => {
    await stubCapture(page);
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await page.clock.install();
    await pauseClock(page);
    const urls: string[] = [];
    for (let i = 0; i < 2; i++) {
      await openRecord(page);
      await page.getByTestId("record-start").click();
      await expect(page.getByTestId("record-countdown")).toBeVisible();
      // Each tick is installed after React commits the preceding count. Drive the clock until
      // this take's encoder has actually started; elapsed fake time alone is not that boundary.
      await expect
        .poll(async () => {
          await page.clock.fastForward(1000);
          return rec(page, "starts");
        })
        .toBe(i + 1);
      await page.getByTestId("record-stop").click();
      await page.clock.fastForward(100);
      await expect(page.getByTestId("record-review")).toBeVisible();
      const url = await page.getByTestId("record-preview").getAttribute("src");
      if (!url) throw new Error("Expected a recording URL");
      urls.push(url);
      await page.getByTestId("record-discard").click();
    }
    await page.getByTestId("record-discard-undo").hover();
    await page.clock.fastForward(9000);
    expect(await rec(page, "revoked")).toEqual([urls[0]]);
    await page.getByTestId("record-discard-undo").click();
    await page.clock.fastForward(9000);
    expect(await rec(page, "revoked")).toEqual([urls[0]]);
    await expect(page.getByTestId("record-preview")).toHaveAttribute("src", urls[1]);
    await page.getByTestId("record-discard").click();
    // Modal focus returns to its consumed opener; leave it so the next discard can start expiring.
    await page.getByTestId("live-more").focus();
    await page.clock.fastForward(9000);
    expect(await rec(page, "revoked")).toEqual(urls);
  });
  test("a consumed recording Undo cannot restore or revoke a later discard's clip", async ({ page }) => {
    await stubCapture(page);
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await page.clock.install();
    await pauseClock(page);
    await openRecord(page);
    await page.getByTestId("record-start").click();
    await expect(page.getByTestId("record-countdown")).toBeVisible();
    await expect
      .poll(async () => {
        await page.clock.fastForward(1000);
        return rec(page, "started");
      })
      .toBe(true);
    await page.getByTestId("record-stop").click();
    await page.clock.fastForward(100);
    await expect(page.getByTestId("record-review")).toBeVisible();
    const url = await page.getByTestId("record-preview").getAttribute("src");
    if (!url) throw new Error("Expected a recording URL");
    await page.getByTestId("record-discard").click();
    const undo = page.getByTestId("record-discard-undo");
    await undo.focus();
    const toastId = await undo.evaluate((el) => el.closest<HTMLElement>("[data-toast-id]")?.dataset.toastId);
    expect(toastId).toBeDefined();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("record-preview")).toHaveAttribute("src", url);
    await page.getByTestId("record-discard").click();
    await expect(undo).toBeFocused();
    await expect(undo).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("record-review")).toHaveCount(0);
    expect(await rec(page, "revoked")).not.toContain(url);
    // Leaving the retained opener promotes the fresh Undo, whose closure owns this discard.
    await page.getByTestId("live-more").focus();
    await expect(undo).not.toHaveAttribute("aria-disabled", "true");
    const freshId = await undo.evaluate((el) => el.closest<HTMLElement>("[data-toast-id]")?.dataset.toastId);
    expect(freshId).toBeDefined();
    expect(freshId).not.toBe(toastId);
    await undo.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("record-preview")).toHaveAttribute("src", url);
    await page.getByTestId("record-discard").click();
    await page.getByTestId("live-more").focus();
    expect(await rec(page, "revoked")).not.toContain(url);
    await undo.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("record-preview")).toHaveAttribute("src", url);
    // No discarded notification may revoke the clip restored by the latest action.
    await page.clock.fastForward(9000);
    expect(await rec(page, "revoked")).not.toContain(url);
    await page.getByTestId("record-discard").click();
    await page.getByTestId("live-more").focus();
    await page.clock.fastForward(9000);
    expect(await rec(page, "revoked")).toEqual([url]);
  });

  test("start → countdown → indicator → stop → review → download", async ({ page, consoleErrors }) => {
    await stubCapture(page);
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&sim=${OUTAGE}&paused=1`);
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
    expect(await rec(page, "framedTo")).toBe("app");
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
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    // An empty spot on the canvas (between the nodes and the live bar).
    await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: 600, y: 600 } });
    await page.getByTestId("context-menu-item-sim.record").click();
    await expect(page.getByTestId("record-setup")).toBeVisible();
    // Free play has nothing to play from the start.
    await expect(page.getByTestId("record-opt-from-start")).toHaveCount(0);
    // Every take is in presentation view: no option to forget.
    await expect(page.getByTestId("record-what")).toContainText("presentation view");
    await page.getByTestId("record-start").click();
    await expect(page.getByTestId("record-indicator")).toBeVisible({ timeout: 6_000 });
    await expect(page).toHaveURL(/present=1/);
    // The recorder starts two frames after the indicator shows; a stop before that cancels instead.
    await expect.poll(() => rec(page, "started")).toBe(true);
    // L doesn't leave live view mid-take; Esc stops the recording (and only that).
    await page.keyboard.press("l");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("record-review")).toBeVisible();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    // The take turned presentation on, so stopping turns it back off.
    await expect(page).not.toHaveURL(/present=1/);

    await page.getByTestId("record-discard").click();
    await expect(page.getByTestId("record-review")).toHaveCount(0);
    await page.getByTestId("record-discard-undo").click();
    await expect(page.getByTestId("record-review")).toBeVisible();
    await expect(page.getByTestId("record-meta")).toContainText("48 KB");
  });

  test("Esc during the countdown cancels without recording", async ({ page }) => {
    await stubCapture(page);
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
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

  test("Esc after the countdown but before the recorder starts cancels cleanly", async ({ page, consoleErrors }) => {
    await stubCapture(page);
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    // A paused clock holds the two frames between the countdown's end and the recorder's start.
    await page.clock.install();
    await pauseClock(page);
    await openRecord(page);
    await page.getByTestId("record-start").click();
    const countdown = page.getByTestId("record-countdown");
    for (const next of ["2", "1"]) {
      await expect(countdown).toBeVisible();
      await page.clock.runFor(1000);
      await expect(countdown).toContainText(next);
    }
    await page.clock.runFor(1000);
    await expect(page.getByTestId("record-indicator")).toBeVisible();
    await expect(page).toHaveURL(/present=1/);
    expect(await rec(page, "started")).toBeUndefined();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("record-indicator")).toHaveCount(0);
    await expect.poll(() => rec(page, "stopped")).toBe(1);
    await expect(page).not.toHaveURL(/present=1/);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page.getByTestId("record-error")).toHaveCount(0);
    await expect(page.getByTestId("record-review")).toHaveCount(0);
    // Releasing the held frames never starts the cancelled take.
    await page.clock.runFor(500);
    expect(await rec(page, "started")).toBeUndefined();
    await expect(page.getByTestId("record-setup")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("a refused share prompt explains itself and nothing breaks", async ({ page, consoleErrors }) => {
    await stubCapture(page, { prompt: "deny" });
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
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
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
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
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&sim=${OUTAGE}&speed=8`);
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
    await page.clock.install();
    await stubCapture(page, { realRecorder: true });
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await openRecord(page);
    await recordFor(page, 2);
    await expect(page.getByTestId("record-elapsed")).toHaveText("0:02");
    const stoppedAt = await page.evaluate(() => performance.now());
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
    expect(
      await page.evaluate(() => performance.now()),
      "encoder and review work leave the controlled clock paused",
    ).toBe(stoppedAt);
  });
});
