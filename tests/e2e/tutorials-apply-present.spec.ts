import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { test, expect, expectNoErrors, pageLoadTimeout } from "./fixtures";
import { openTutorial, play, strip, finishSolution, expectNothingSaved } from "./pointer-tutorial-driver";
import { expectPlaying, watchedPage, filePayloadText } from "./html-viewer";

test("batch6 exports: real SVG/PNG properties and a saved HTML story replayed offline", async ({
  page,
  browser,
  consoleErrors,
}, info) => {
  test.slow(); // Three real writers plus the offline replay share this test.
  await openTutorial(page, "export-for-audience");
  await page.getByTestId("tutorial-start").click();
  let htmlPath = "";
  for (const format of ["svg", "png", "html"] as const) {
    await expect(strip(page)).toHaveAttribute("data-step", format);
    const actions = await page.evaluate(() => window.__tutorial?.solution() ?? []);
    for (const action of actions.slice(0, -1)) await play(page, action);
    const pending = page.waitForEvent("download");
    const submit = actions.at(-1);
    if (!submit) throw new Error("The export lesson has no submit action");
    await play(page, submit);
    const download = await pending;
    const path = info.outputPath(download.suggestedFilename());
    await download.saveAs(path);
    expect(await download.failure()).toBeNull();
    const bytes = await readFile(path);
    if (format === "svg") {
      const svg = bytes.toString("utf8");
      expect(svg).toContain("Give someone the right artifact");
      const properties = await page.evaluate((text) => {
        const root = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
        return {
          name: root.localName,
          width: Number(root.getAttribute("width")),
          height: Number(root.getAttribute("height")),
          error: root.getElementsByTagName("parsererror").length,
        };
      }, svg);
      expect(properties.name).toBe("svg");
      expect(properties.error).toBe(0);
      expect(properties.width).toBeGreaterThan(300);
      expect(properties.height).toBeGreaterThan(100);
      expect(svg).not.toContain('data-testid="grow-chip-');
    } else if (format === "png") {
      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(bytes.toString("ascii", 12, 16)).toBe("IHDR");
      expect(bytes.readUInt32BE(16)).toBeGreaterThan(300);
      expect(bytes.readUInt32BE(20)).toBeGreaterThan(100);
    } else {
      htmlPath = path;
      const payload = JSON.parse(filePayloadText(bytes.toString("utf8"))) as {
        diagram: { simulations: { id: string }[] };
        options: { startSimulation: string };
      };
      expect(payload.diagram.simulations.map((s) => s.id)).toEqual(["black-friday", "payments-outage"]);
      expect(payload.options.startSimulation).toBe("black-friday");
    }
  }
  await finishSolution(page);
  await expectNothingSaved(page);
  const offline = await browser.newContext({ offline: true });
  try {
    const viewer = await watchedPage(offline);
    await viewer.page.goto(pathToFileURL(htmlPath).href);
    await expectPlaying(viewer.page);
    expect(viewer.requests.filter((url) => /^https?:/.test(url))).toEqual([]);
    expect(viewer.errors).toEqual([]);
  } finally {
    await offline.close();
  }
  expectNoErrors(consoleErrors);
});

test("batch6 export refusal offers Retry and cannot count a failed writer", async ({ page }) => {
  await openTutorial(page, "export-for-audience");
  await page.getByTestId("tutorial-start").click();
  await page.evaluate(() => {
    const click = HTMLAnchorElement.prototype.click;
    let refuse = true;
    HTMLAnchorElement.prototype.click = function () {
      if (refuse && this.download.endsWith(".svg")) {
        refuse = false;
        throw new Error("Practice writer refused");
      }
      click.call(this);
    };
  });
  await page.getByTestId("tutorial-skip").click();
  await page.waitForFunction(() => window.__tutorial?.snapshot().state.value === "failed");
  await expect(page.getByTestId("tutorial-retry")).toBeVisible();
  await expect(strip(page)).toHaveAttribute("data-step", "svg");
  const pending = page.waitForEvent("download");
  await page.getByTestId("tutorial-retry").click();
  await pending;
  await expect(strip(page)).toHaveAttribute("data-step", "png");
});

test("batch6 local peers exercise roles and leaving without sockets or persisted copies", async ({
  page,
  consoleErrors,
}) => {
  await page.addInitScript(() => {
    const forbidden = function () {
      throw new Error("Practice must stay in process");
    };
    Object.defineProperty(window, "WebSocket", { value: forbidden });
    Object.defineProperty(window, "RTCPeerConnection", { value: forbidden });
  });
  await openTutorial(page, "work-together");
  await expect(page.getByTestId("tutorial-intro-optional")).toContainText("optional extensions");
  await page.getByTestId("tutorial-start").click();
  for (const action of ["join", "edit", "watch", "leave"] as const) {
    await expect(strip(page)).toHaveAttribute("data-step", action);
    await page.getByTestId(`tutorial-peer-${action}`).click();
    await expect(strip(page)).not.toHaveAttribute("data-step", action, { timeout: pageLoadTimeout() });
  }
  await expect(page.getByTestId("tutorial-peer-recovery")).toContainText("Reviewed status worker");
  await finishSolution(page);
  await expect(page.getByTestId("tutorial-handoff-heading")).toHaveText("Optional extension complete");
  await expectNothingSaved(page);
  expectNoErrors(consoleErrors);
});

test("batch6 hub keeps chapter VII numbered and optional lessons outside core seals", async ({ page }, info) => {
  await page.goto("./?view=tutorials");
  await page.getByTestId("tutorials-chapter-sharing").click();
  await expect(page.getByTestId("tutorial-card-share-present")).toContainText("7.1");
  await expect(page.getByTestId("tutorial-card-export-for-audience")).toContainText("7.2");
  await expect(page.getByTestId("tutorial-card-work-together")).toContainText("7.3");
  await expect(page.getByTestId("tutorial-card-review-agent-changes")).toContainText("7.4");
  await expect(page.getByTestId("tutorial-optional-work-together")).toHaveText("Optional extension");
  await expect(page.getByTestId("tutorial-optional-review-agent-changes")).toHaveText("Optional extension");
  await expect(page.getByTestId("tutorials-overall")).toContainText("0 of 60 core lessons · 0 of 8 seals");
  await page.screenshot({ path: info.outputPath("hub-chapter-vii.png"), fullPage: true });
  await page.getByTestId("tutorials-seals").click();
  await expect(page.getByTestId("tutorials-seal-chapter-sharing")).toContainText("Not yet · 0 of 2");
  await expect(page.getByTestId("tutorials-seal-whole-syllabus")).toContainText("60 core lessons");
});

test("batch6 supplied replies use the named Read note control and stay left-to-right", async ({ page }) => {
  await openTutorial(page, "review-agent-changes");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("ai-rail-open").click();
  await expect(strip(page)).toHaveAttribute("data-step", "read");
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "context");
  for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
  await expect(strip(page)).toHaveAttribute("data-step", "apply");
  await expect(page.getByTestId("coach-hint")).toHaveText("Read note");
  await page.getByTestId("coach-hint").click();
  await expect(page.getByTestId("tutorial-note")).toHaveAttribute("dir", "ltr");
  const reply = await page.getByTestId("tutorial-note").inputValue();
  expect(JSON.parse(reply).ops[0]).toMatchObject({ op: "add_node", kind: "service.go" });
});

for (const sample of [
  { locale: "en", width: 1440, height: 900, dark: false },
  { locale: "ar", width: 390, height: 844, dark: true },
  { locale: "en-XA", width: 780, height: 390, dark: false },
])
  test(`batch6 readability: chapter VII ${sample.locale} ${sample.width}`, async ({ page }, info) => {
    await page.setViewportSize({ width: sample.width, height: sample.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(({ locale, dark }) => {
      localStorage.setItem("diagrams.locale", locale);
      localStorage.setItem(
        "diagrams.settings.v1",
        JSON.stringify({ theme: dark ? "dark" : "light", themePreference: dark ? "dark" : "light" }),
      );
    }, sample);
    await page.goto("./?view=tutorials");
    await page.getByTestId("tutorials-chapter-sharing").click();
    await expect(page.getByTestId("tutorial-optional-work-together")).toBeVisible();
    await expect(page.getByTestId("tutorial-optional-review-agent-changes")).toBeVisible();
    await page.screenshot({ path: info.outputPath(`hub-vii-${sample.locale}-${sample.width}.png`), fullPage: true });
    await openTutorial(page, "study-fanout");
    await page.getByTestId("tutorial-start").click();
    await page.getByTestId("coach-hint").click();
    await expect(page.getByTestId("tutorial-note")).toBeVisible();
    await expect(page.getByTestId("tutorial-skip")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("tutorial-exit")).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath(`fanout-checklist-${sample.locale}-${sample.width}.png`) });
  });
