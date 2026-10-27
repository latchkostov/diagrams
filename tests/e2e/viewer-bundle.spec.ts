import { openLiveNodeDetails } from "./fixtures";
import type { Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect, pauseClock, E2E_TARGET, waitForStableViewport, waitForCameraIdle } from "./fixtures";
import { recordFor } from "./recording-clock";
import { E2E_PROFILES } from "../../scripts/e2e-profiles.mjs";
import { textFieldsFixture } from "../../src/lab/textFieldsFixture";
import type { ViewerAdapter } from "../../src/export/viewer/adapter";
import latencyDiagram from "../../src/examples/where-the-time-goes.json" with { type: "json" };
import { autoscalingFixture } from "../../src/lab/autoscalingFixture";
import { hpaLesson } from "../../src/model/autoscalingLessons";
import { CATCH_UP_MS } from "../../src/live/frameClock";
import { exportHtml } from "../../src/export/inject";

/** Set up engine state before capture without drawing every idle frame. */
async function advanceSetupClock(page: Page, duration: number) {
  for (let remaining = duration; remaining > 0;) {
    const step = Math.min(remaining, CATCH_UP_MS);
    await page.clock.fastForward(step);
    remaining -= step;
  }
}

// Keep this independent of editor controls: the built viewers must retain the playback runtime
// even when their routing/autoscaling authoring modules are swapped out.
for (const viewer of ["bundle", "skill", "Interactive HTML"] as const) {
  test(`${viewer}: busy-thread autoscaling, readouts and a recorded replay`, async ({ page }) => {
    const diagram = autoscalingFixture();
    diagram.planning = { revision: "p3-w1" };
    const policy = hpaLesson();
    Object.assign(policy.controller.settings, {
      syncMs: 1000,
      initialReadinessDelayMs: 0,
      cpuInitializationPeriodMs: 0,
      metrics: [
        {
          source: { kind: "pods", metric: "busyThreads" },
          target: { kind: "averageValue", value: 1 },
          windowMs: 1000,
          metricDelayMs: 0,
        },
      ],
    });
    const props = diagram.nodes[1].props;
    if (!props?.resources) throw new Error("The autoscaling fixture must include compute resources");
    props.autoscaling = policy;
    props.resources.startup.delayMs = 1000;
    diagram.simulations = [
      {
        id: "busy",
        title: "Busy threads",
        durationMs: 8000,
        traffic: [{ id: "load", node: "source", shape: { kind: "constant", ratePerSec: 80, durationMs: 8000 } }],
      },
    ];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install();
    if (viewer === "bundle") {
      await openViewer(page);
      await page.evaluate((d) => window.liveDiagramsViewer.load(d), diagram);
    } else {
      const template =
        viewer === "skill"
          ? readFileSync("skills/livediagrams/scripts/lib/viewer-template.html", "utf8")
          : readFileSync(join(E2E_PROFILES.e2e.outDir, "skill/scripts/lib/viewer-template.html"), "utf8");
      const file = test.info().outputPath("autoscaling.html");
      writeFileSync(
        file,
        exportHtml(template, {
          diagram,
          iconSvgs: Object.fromEntries(
            ["client-browser", "dotnet"].map((name) => [name, readFileSync(`src/stencils/icons/${name}.svg`, "utf8")]),
          ),
          theme: "light",
          startSimulation: null,
        }),
      );
      await page.goto(pathToFileURL(file).href);
    }
    await expect(page.getByTestId("node-worker")).toBeVisible();
    await waitForCameraIdle(page);
    await waitForStableViewport(page);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await pauseClock(page);
    await page.getByTestId("live-sim-picker").selectOption("busy");
    await page.getByTestId("live-speed").selectOption("1");
    const badge = page.getByTestId("node-badge-worker");
    await expect(badge).toHaveAttribute("data-ready", "1");
    await advanceSetupClock(page, 1500);
    await expect.poll(async () => Number(await badge.getAttribute("data-desired"))).toBeGreaterThan(1);
    await expect.poll(async () => Number(await badge.getAttribute("data-starting"))).toBeGreaterThan(0);
    await advanceSetupClock(page, 1500);
    await expect.poll(async () => Number(await badge.getAttribute("data-ready"))).toBeGreaterThan(1);
    await openLiveNodeDetails(page, "worker", "resources");
    const details = page.getByTestId("node-detail-worker");
    const ready = Number(await badge.getAttribute("data-ready"));
    const desired = Number(await badge.getAttribute("data-desired"));
    const starting = Number(await badge.getAttribute("data-starting"));
    // A subsequent controller tick can already have requested another replica. The
    // badge then reports Starting instead of Desired; both must match the fleet.
    const fleetText = starting ? `Ready: ${ready} · Starting: ${starting}` : `Ready: ${ready} → Desired: ${desired}`;
    await expect(page.getByTestId("node-fleet-worker")).toHaveText(new RegExp(`^◷${fleetText}( · Max reached)?$`));
    await expect(page.getByTestId("hover-section-resources")).toContainText(`${ready} ready → ${desired} desired`);
    await expect(details).toContainText(/CPU: [1-9]\d*%/);
    await expect(details).toContainText(/Memory: [1-9]\d* MiB/);
    await page.getByTestId("node-worker").evaluate((el) => el.parentElement?.blur());
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-record").click();
    await expect(page.getByTestId("record-opt-from-start")).toBeChecked();
    await recordFor(page, 0, { countdown: "ticks" });
    await expect(badge).toHaveAttribute("data-ready", "1");
    await page.clock.runFor(3000);
    await expect.poll(async () => Number(await badge.getAttribute("data-ready"))).toBeGreaterThan(1);
    await page.clock.runFor(6000);
    await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-sim-time", "8000");
    // The recorder holds the completed simulation's last frame before finalizing.
    await page.clock.runFor(1500);
    const preview = page.getByTestId("record-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("src", /^blob:/);
    await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(1);
    // Metadata alone also loads when playback is broken. Observe decoded frames
    // from the actual recording, independent of the simulation's fake clock.
    await preview.evaluate(async (video: HTMLVideoElement) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Missing recorded replay pixel context");
      let firstFrame: { pixels: Uint8ClampedArray; time: number } | undefined;
      const frame: VideoFrameRequestCallback = (_now, metadata) => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const previous = firstFrame;
        if (!previous) {
          firstFrame = { pixels, time: metadata.mediaTime };
        } else if (metadata.mediaTime > previous.time && pixels.some((value, i) => value !== previous.pixels[i])) {
          video.dataset.replayFrameChanged = "true";
          return;
        }
        video.requestVideoFrameCallback(frame);
      };
      video.currentTime = 0;
      // Capture time varies with load. Decode the full replay at 4x while retaining
      // the changed-frame, natural completion and paused-at-end assertions below.
      video.playbackRate = 4;
      video.requestVideoFrameCallback(frame);
      await video.play();
    });
    await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
    await expect(preview).toHaveAttribute("data-replay-frame-changed", "true");
    await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.ended)).toBe(true);
    expect(await preview.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test.skip(E2E_TARGET !== "build", "the static viewer artifact is generated by the production build only");

test.use({ channel: "chromium", launchOptions: { args: ["--auto-accept-this-tab-capture"] } });

let server: Server;
let origin: string;
// Deliberately independent of the generated meta policy: hosting may impose this stricter header.
const FORGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src blob:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'";
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
          : name.endsWith(".svg")
            ? "image/svg+xml"
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

async function openViewer(page: import("@playwright/test").Page) {
  await page.goto(origin);
  await page.waitForFunction(() => !!window.liveDiagramsViewer);
}

test("cached pagehide/pageshow preserves the diagram, adapter and later teardown", async ({ page }) => {
  await openViewer(page);
  await page.evaluate((d) => window.liveDiagramsViewer.load(d), textFieldsFixture);
  await expect(page.getByTestId("node-a")).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(page.getByTestId("node-a")).toBeVisible();
  await page.evaluate(
    (d) =>
      window.liveDiagramsViewer.load({
        ...d,
        nodes: d.nodes.map((node) => (node.id === "a" ? { ...node, label: "Restored" } : node)),
      }),
    textFieldsFixture,
  );
  await expect(page.getByTestId("node-a")).toContainText("Restored");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  await expect(page.getByTestId("viewer-bundle")).toHaveCount(0);
  await page.evaluate((d) => window.liveDiagramsViewer.load(d), textFieldsFixture);
  await expect(page.getByTestId("viewer-bundle")).toHaveCount(0);
});

test("keyboard zoom, pan and fit work under Forge CSP with named buttons and lazy icons", async ({ page }) => {
  const violations: string[] = [];
  const icons: string[] = [];
  await page.exposeFunction("reportViolation", (directive: string) => violations.push(directive));
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { reportViolation(d: string): void }).reportViolation(e.effectiveDirective),
    ),
  );
  page.on("request", (r) => {
    if (r.url().endsWith(".svg")) icons.push(r.url());
  });
  await openViewer(page);
  await page.evaluate((d) => window.liveDiagramsViewer.load(d), textFieldsFixture);
  const node = page.getByTestId("node-a");
  await expect(node).toBeVisible();
  await waitForCameraIdle(page);
  await waitForStableViewport(page);
  await expect(page.getByTestId("viewer-zoom-in")).toHaveAccessibleName("Zoom in");
  await expect(page.getByTestId("viewer-zoom-out")).toHaveAccessibleName("Zoom out");
  await expect(page.getByTestId("viewer-fit")).toHaveAccessibleName("Fit view");
  const bounds = () =>
    node.evaluate((el) => {
      const { x, width } = el.getBoundingClientRect();
      return { x, width };
    });
  const box = await bounds();
  await page.getByTestId("viewer-zoom-in").focus();
  await page.keyboard.press("+");
  await expect.poll(async () => (await bounds()).width / box.width).toBeGreaterThan(1.1);
  await waitForStableViewport(page);
  const zoomed = await bounds();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await bounds()).x).toBeLessThan(zoomed.x);
  await waitForStableViewport(page);
  await page.keyboard.press("Shift+Digit1");
  await waitForCameraIdle(page);
  await expect.poll(async () => (await bounds()).width / box.width).toBeCloseTo(1, 1);
  await expect.poll(async () => (await bounds()).x).toBeCloseTo(box.x, 0);
  await expect.poll(() => icons.length).toBe(1);
  expect(icons[0]).toMatch(/\/assets\/client-browser-[a-f0-9]+\.svg$/);
  expect(violations).toEqual([]);
});

for (const saved of [false, true]) {
  test(`host play starts from a static load: ${saved ? "saved simulation" : "free play"}`, async ({ page }) => {
    await openViewer(page);
    await page.evaluate(
      ({ d, saved }) => {
        window.liveDiagramsViewer.load({
          ...d,
          simulations: [{ id: "flow", title: "Flow", durationMs: 60_000, traffic: [] }],
        });
        window.liveDiagramsViewer.play(saved ? "flow" : undefined);
      },
      { d: textFieldsFixture, saved },
    );
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
    await expect(page.getByTestId("live-sim-picker")).toHaveValue(saved ? "flow" : "");
  });
}

test("arrow keys scroll Live reading regions without panning the bundle's camera", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await openViewer(page);
  await page.evaluate((d) => {
    window.liveDiagramsViewer.load(d);
    window.liveDiagramsViewer.play("billing-spike");
    window.liveDiagramsViewer.stop();
  }, latencyDiagram);
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
  const input = page.getByTestId("live-timeline-input");
  await input.fill("1000");
  await input.press("ArrowRight");
  await waitForCameraIdle(page);
  const node = page.getByTestId("node-billing");
  await node.hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -1600);
  await page.keyboard.up("Control");
  await waitForStableViewport(page);
  await node.hover();
  await openLiveNodeDetails(page, "billing", "latency");
  const detail = page.getByTestId("node-detail-billing");
  await expect(detail).toBeVisible();
  await expect.poll(() => detail.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await detail.focus();
  await expect(detail).toBeFocused();
  // Native arrow scrolling can outlive the instant Home below. Check that the
  // readout owns this key, so the regression fails without waiting for that race.
  await detail.evaluate((el) => {
    document.addEventListener(
      "keydown",
      (event) => {
        el.setAttribute("data-arrow-default-prevented", String(event.defaultPrevented));
      },
      { once: true },
    );
  });
  const before = await node.boundingBox();
  await page.keyboard.press("ArrowDown");
  await expect(detail).toHaveAttribute("data-arrow-default-prevented", "true");
  await expect(page.getByTestId("hover-section-latency")).toBeFocused();
  await waitForCameraIdle(page);
  expect(await node.boundingBox()).toEqual(before);
  await detail.focus();
  await page.keyboard.press("Home");
  await expect.poll(() => detail.evaluate((el) => el.scrollTop)).toBe(0);
});

test("host stop during startup ends paused", async ({ page }) => {
  await openViewer(page);
  await page.evaluate((d) => {
    window.liveDiagramsViewer.load(d);
    window.liveDiagramsViewer.play();
    window.liveDiagramsViewer.stop();
  }, textFieldsFixture);
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
});

test("live exports and recording preview use local blobs, with accessible toast feedback and Undo", async ({
  page,
}) => {
  const violations: string[] = [];
  await page.exposeFunction("reportViolation", (directive: string) => violations.push(directive));
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { reportViolation(d: string): void }).reportViolation(e.effectiveDirective),
    ),
  );
  await page.clock.install();
  await openViewer(page);
  await page.evaluate((d) => {
    window.liveDiagramsViewer.load(d);
    window.liveDiagramsViewer.play();
  }, textFieldsFixture);
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-trace-message").click();
  await page.getByTestId("live-trace-next").click();
  await expect(page.getByTestId("trace-card")).toHaveAttribute("data-state", "done");
  await page.getByTestId("trace-sequence").click();
  // Clipboard failure must be visible and announced, including in a host that denies copying.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Denied")) },
    });
    document.execCommand = () => false;
  });
  await page.getByTestId("sequence-copy-mermaid").click();
  await expect(page.getByTestId("toast")).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("toast")).toContainText("didn't allow copying");
  await page.getByTestId("toast-dismiss").click();
  const [png] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sequence-download-png").click()]);
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  expect(await png.failure()).toBeNull();
  await page.keyboard.press("Escape");
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-record").click();
  await recordFor(page, 1);
  await page.getByTestId("record-stop").click();
  const preview = page.getByTestId("record-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
  await page.getByTestId("record-discard").click();
  await expect(page.getByTestId("record-discard-undo")).toBeVisible();
  await page.getByTestId("record-discard-undo").click();
  await expect(preview).toBeVisible();
  expect(violations).toEqual([]);
});
