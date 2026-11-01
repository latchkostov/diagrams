import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { test, expect, expectNoErrors, pageLoadTimeout, pauseClock } from "./fixtures";
import {
  openTutorial,
  play,
  strip,
  finishSolution,
  expectNothingSaved,
  advanceTutorialClock,
  skipAll,
} from "./pointer-tutorial-driver";
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

for (const [id, index] of [
  ["export-for-audience", 1],
  ["work-together", 2],
  ["review-agent-changes", 5],
  ["share-present", 3],
  ...["study-checkout", "study-dispatch", "study-payments", "study-fanout", "study-rag", "study-cells"].map(
    (id) => [id, 1] as const,
  ),
] as const)
  test(`batch6 Continue reconstructs ${id} and its real predecessor`, async ({ page, consoleErrors }) => {
    test.slow();
    await page.clock.install();
    await openTutorial(page, id);
    await page.getByTestId("tutorial-start").click();
    await pauseClock(page);
    while ((await page.evaluate(() => window.__tutorial?.snapshot().state.index ?? 0)) < index) {
      if (await page.getByTestId("present-exit").isVisible()) await page.keyboard.press("Escape");
      if (await page.getByTestId("share-chooser").isVisible()) await page.keyboard.press("Escape");
      const prior = await page.evaluate(() => window.__tutorial?.snapshot().state.index ?? 0);
      if (prior >= index) break;
      await page.getByTestId("tutorial-skip").click();
      await advanceTutorialClock(
        page,
        async () => (await page.evaluate(() => window.__tutorial?.snapshot().state.index ?? 0)) > prior,
      );
    }
    const normalized = () =>
      page.evaluate(() => {
        const diagram = window.__tutorial?.diagram();
        if (!diagram) throw new Error("Practice diagram missing");
        return {
          nodes: diagram.nodes.map(({ stencil, label, props, group }) => ({
            stencil,
            label,
            props,
            group: diagram.groups?.find((g) => g.id === group)?.label,
          })),
          edges: diagram.edges.map(({ from, to, kind, relation, props }) => ({
            from: diagram.nodes.findIndex((n) => n.id === from),
            to: diagram.nodes.findIndex((n) => n.id === to),
            kind,
            relation,
            props,
          })),
        };
      });
    const predecessor = await normalized();
    await page.reload();
    await expect(page.getByTestId("tutorial-start")).toContainText("Continue", { timeout: pageLoadTimeout() });
    await page.getByTestId("tutorial-start").click();
    await pauseClock(page);
    await advanceTutorialClock(page, async () =>
      ["active", "hinting", "completing"].includes((await strip(page).getAttribute("data-state")) ?? ""),
    );
    expect(await page.evaluate(() => window.__tutorial?.snapshot().state.index)).toBe(index);
    expect(await normalized()).toEqual(predecessor);
    if (id === "review-agent-changes") {
      await expect(page.getByTestId("ai-panel")).toBeVisible();
      expect(predecessor.nodes).toHaveLength(1);
    }
    if (id === "work-together") await expect(page.getByTestId("tutorial-peer-watch")).toBeVisible();
    await page.clock.resume();
    await skipAll(page);
    await expectNothingSaved(page);
    expectNoErrors(consoleErrors);
  });

test("batch6 assisted and dialog HTML exports retain Private provenance", async ({ page }) => {
  await openTutorial(page, "export-for-audience");
  await page.getByTestId("tutorial-start").click();
  for (const format of ["svg", "png"]) {
    await expect(strip(page)).toHaveAttribute("data-step", format);
    const pending = page.waitForEvent("download");
    await page.getByTestId("tutorial-skip").click();
    await pending;
  }
  await expect(strip(page)).toHaveAttribute("data-step", "html");
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").hover();
  await page.getByTestId("privacy-diagram").click();
  await page.keyboard.press("Escape");
  const assisted = page.waitForEvent("download");
  await page.getByTestId("tutorial-skip").click();
  const first = await assisted;
  const firstPath = await first.path();
  if (!firstPath) throw new Error("Missing assisted export");
  expect(JSON.parse(filePayloadText(await readFile(firstPath, "utf8"))).diagram.private).toBe(true);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-html").click();
  const normal = page.waitForEvent("download");
  await page.getByTestId("html-export-download").click();
  const second = await normal;
  const secondPath = await second.path();
  if (!secondPath) throw new Error("Missing dialog export");
  expect(JSON.parse(filePayloadText(await readFile(secondPath, "utf8"))).diagram.private).toBe(true);
});

test("batch6 peer actions stay usable with a full-height phone Properties sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTutorial(page, "work-together");
  await page.getByTestId("tutorial-start").click();
  await page.getByTestId("coach-fold").click();
  await page.getByTestId("node-api").click();
  await page.getByTestId("dock-snap-full").click();
  await page.getByTestId("coach-fold").click();
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-sheet-snap", "full");
  await expect(page.getByTestId("coach-card")).toHaveAttribute("data-compact", "true");
  await expect(page.getByTestId("tutorial-words")).toBeHidden();
  const join = page.getByTestId("tutorial-peer-join");
  await expect(join).toBeVisible();
  await join.focus();
  await expect(join).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(strip(page)).toHaveAttribute("data-step", "edit");
  await expect(page.getByTestId("tutorial-peer-edit")).toBeVisible();
});

test("batch6 assisted Undo completes after the learner already used toolbar Undo", async ({ page, consoleErrors }) => {
  await openTutorial(page, "review-agent-changes");
  await page.getByTestId("tutorial-start").click();
  for (const step of ["open", "read", "context"]) {
    await expect(strip(page)).toHaveAttribute("data-step", step);
    await page.getByTestId("tutorial-skip").click();
    await expect(strip(page)).not.toHaveAttribute("data-step", step);
  }
  await expect(strip(page)).toHaveAttribute("data-step", "apply");
  for (const action of await page.evaluate(() => window.__tutorial?.solution() ?? [])) await play(page, action);
  await expect(strip(page)).toHaveAttribute("data-step", "undo");
  await page.getByTestId("undo-button").click();
  expect(await page.evaluate(() => window.__tutorial?.diagram().nodes.map((n) => n.id))).toEqual(["api"]);
  await page.getByTestId("tutorial-skip").click();
  await expect(strip(page)).toHaveAttribute("data-step", "again");
  await expect(page.getByTestId("tutorial-retry")).toHaveCount(0);
  await expectNothingSaved(page);
  expectNoErrors(consoleErrors);
});
