import { nestedBoundariesFixture as nestedFixture } from "../../src/lab/nestedBoundariesFixture";
import { test, expect, expectNoErrors, gotoCanvas, waitForStableViewport, STORAGE_KEYS, type Page } from "./fixtures";

async function boxOf(locator: import("@playwright/test").Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Missing drag geometry");
  return box;
}

const SLUG = "kafka-order-pipeline";

async function seed(page: Page, diagram: unknown) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("__seeded")) {
        sessionStorage.setItem("__seeded", "1");
        localStorage.setItem(key, value);
      }
    },
    [STORAGE_KEYS.autosavePrefix + SLUG, JSON.stringify(diagram)] as const,
  );
  await gotoCanvas(page, SLUG);
  await expect(page.getByTestId("group-label-grp-core")).toBeVisible();
  await waitForStableViewport(page);
}

const fixtureDiagram = {
  format: "diagrams/v1",
  title: "Zones and Boundaries Test",
  groups: [{ id: "grp-core", label: "Core cluster", tone: "azure", x: 100, y: 100, width: 600, height: 400 }],
  nodes: [
    { id: "api", stencil: "client.browser", label: "API Gateway", x: 150, y: 150, group: "grp-core" },
    { id: "worker", stencil: "client.browser", label: "Worker", x: 350, y: 150, group: "grp-core" },
    { id: "outside", stencil: "client.browser", label: "Outside", x: 800, y: 150 },
  ],
  annotations: [
    { id: "zone-1", kind: "zone", text: "DMZ Zone", x: 750, y: 100, width: 300, height: 300, color: "yellow" },
  ],
  edges: [],
};

test.describe("Zones and Boundaries enhancements", () => {
  test.beforeEach(async ({ page }) => {
    await seed(page, fixtureDiagram);
  });

  test("boundary inspector shows custom tone button, size fields, copy ID, and convert button", async ({
    page,
    consoleErrors,
  }) => {
    // Click the boundary label to select it
    await page.getByTestId("group-label-grp-core").click();

    // Verify Inspector fields for Boundary
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("Core cluster");
    await expect(page.getByTestId("inspector-field-width")).toHaveValue("600");
    await expect(page.getByTestId("inspector-field-height")).toHaveValue("400");
    await expect(page.getByTestId("inspector-tone-custom-btn")).toBeVisible();
    await expect(page.getByTestId("inspector-group-convert")).toBeVisible();
    await expect(page.getByTestId("inspector-copy-id")).toBeVisible();

    // Update width via inspector
    await page.getByTestId("inspector-field-width").fill("650");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("group-grp-core")).toHaveCSS("width", "650px");

    // Open custom color picker
    await page.getByTestId("inspector-tone-custom-btn").click();
    await expect(page.getByTestId("color-picker-modal")).toBeVisible();

    // Pick a custom color by filling the hex input
    await page.getByTestId("color-picker-hex-input").fill("#E11D48");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");

    // Verify boundary has the custom color tone
    await expect(page.getByTestId("group-grp-core")).toHaveCSS("--tone", "#E11D48");

    expectNoErrors(consoleErrors);
  });

  test("converts boundary to zone, and zone to boundary with auto membership", async ({ page, consoleErrors }) => {
    // Select boundary and convert to zone
    await page.getByTestId("group-label-grp-core").click();
    await page.getByTestId("inspector-group-convert").click();

    // Boundary is removed, and zone exists
    await expect(page.getByTestId("group-grp-core")).toHaveCount(0);

    // Zone inspector has input for label (not textarea) and updated hint text
    const zoneLabelInput = page.getByTestId("inspector-field-label");
    await expect(zoneLabelInput).toBeVisible();
    await expect(zoneLabelInput).toHaveValue("Core cluster");
    await expect(zoneLabelInput).toHaveAttribute("name", "annotation-text");

    // Hint text and convert to boundary button
    await expect(page.getByTestId("inspector-annotation-hint")).toContainText(
      "Convert it to a boundary to group nodes",
    );
    const convertToBoundaryBtn = page.getByTestId("inspector-zone-convert");
    await expect(convertToBoundaryBtn).toBeVisible();

    // Convert zone back to boundary
    await convertToBoundaryBtn.click();

    // Boundary is created
    await expect(page.getByTestId("group-outline-boundary-1")).toBeVisible();
    await expect(page.getByTestId("group-label-boundary-1")).toHaveText("Core cluster");

    // Verify nodes inside the zone became members of the boundary
    await page.getByTestId("node-api").click();
    await expect(page.getByTestId("inspector-field-group")).toHaveValue("boundary-1");

    await page.getByTestId("node-worker").click();
    await expect(page.getByTestId("inspector-field-group")).toHaveValue("boundary-1");

    expectNoErrors(consoleErrors);
  });

  test("zone DMZ converts to boundary adopting node-outside inside it", async ({ page, consoleErrors }) => {
    // Click the DMZ zone label
    await page.getByTestId("annotation-label-zone-1").click();

    // Verify zone inspector
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("DMZ Zone");
    await expect(page.getByTestId("inspector-zone-convert")).toBeVisible();

    // Click convert to boundary
    await page.getByTestId("inspector-zone-convert").click();

    // New boundary created
    await expect(page.getByTestId("group-label-boundary-1")).toHaveText("DMZ Zone");

    // node-outside is inside zone-1's box (x: 750, y: 100, 300x300, node at 800, 150)
    // so it should now be in boundary-1
    await page.getByTestId("node-outside").click();
    await expect(page.getByTestId("inspector-field-group")).toHaveValue("boundary-1");

    expectNoErrors(consoleErrors);
  });
});

test("dragging selected parent and child preserves nesting and undo/redo", async ({ page, consoleErrors }) => {
  await seed(page, nestedFixture);
  await page.getByTestId("group-label-grp-core").click();
  await page.getByTestId("group-label-child").click({ modifiers: ["Shift"] });
  await waitForStableViewport(page);
  const elements = ["group-grp-core", "group-child", "node-member", "annotation-note"].map((id) =>
    page.getByTestId(id),
  );
  const before = await Promise.all(elements.map(boxOf));
  const handle = await boxOf(page.getByTestId("group-label-grp-core"));
  const x = handle.x + handle.width / 2,
    y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 10 });
  await page.mouse.up();
  const assertMoved = async () => {
    const after = await Promise.all(elements.map(boxOf));
    const dx = after[0].x - before[0].x,
      dy = after[0].y - before[0].y;
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeGreaterThan(0);
    for (let i = 1; i < after.length; i++) {
      expect(after[i].x - before[i].x).toBeCloseTo(dx, 0);
      expect(after[i].y - before[i].y).toBeCloseTo(dy, 0);
    }
  };
  await expect(async () => assertMoved()).toPass();
  await page.keyboard.press("Escape");
  await page.getByTestId("group-label-child").click();
  await expect(page.getByTestId("inspector-field-group")).toHaveValue("grp-core");
  await page.keyboard.press("Control+z");
  await expect(async () => {
    for (let i = 0; i < elements.length; i++) {
      const box = await boxOf(elements[i]);
      expect(box.x).toBeCloseTo(before[i].x, 0);
      expect(box.y).toBeCloseTo(before[i].y, 0);
    }
  }).toPass();
  await page.keyboard.press("Escape");
  await page.getByTestId("group-label-child").click();
  await expect(page.getByTestId("inspector-field-group")).toHaveValue("grp-core");
  await page.keyboard.press("Control+Shift+z");
  await expect(async () => assertMoved()).toPass();
  await page.keyboard.press("Escape");
  await page.getByTestId("group-label-child").click();
  await expect(page.getByTestId("inspector-field-group")).toHaveValue("grp-core");
  await page.getByTestId("node-member").click();
  await expect(page.getByTestId("inspector-field-group")).toHaveValue("child");
  expectNoErrors(consoleErrors);
});

test("Tab visits an outer boundary before its child and member", async ({ page, consoleErrors }) => {
  await seed(page, nestedFixture);
  await page.getByTestId("group-label-grp-core").click();
  // Focus the boundary's accessible wrapper by the keyboard shortcut, then step through its subtree.
  await page.keyboard.press("Escape");
  await page.getByTestId("canvas-wrap").press("Tab");
  const focus = () => page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  await expect.poll(focus).toBe("rf__node-group:grp-core");
  await page.keyboard.press("Tab");
  await expect.poll(focus).toBe("rf__node-group:child");
  await page.keyboard.press("Tab");
  await expect.poll(focus).toBe("rf__node-member");
  expectNoErrors(consoleErrors);
});

for (const tint of [undefined, "#ff0000", "#00ff00", "#0000ff"]) {
  test(`custom boundary labels and captions meet AA on canvas ${tint ?? "default"}`, async ({ page }) => {
    await seed(page, {
      ...fixtureDiagram,
      color: tint,
      groups: ["#fff", "#000", "#767676", "#fff0"].map((tone, i) => ({
        id: i ? `contrast-${i}` : "grp-core",
        label: "Readable boundary",
        tone,
        x: i * 350,
        y: 0,
        width: 300,
        height: 180,
      })),
      nodes: [],
      annotations: ["#767676", "#fff", "#000", "#fff0"].map((color, i) => ({
        id: `caption-${i}`,
        kind: "text",
        text: "Readable caption",
        color,
        x: i * 350,
        y: 250,
        width: 250,
        height: 40,
      })),
    });
    for (const theme of ["light", "dark"]) {
      await expect(page.getByTestId("theme-toggle")).toHaveAccessibleName(
        theme === "light" ? "Switch to dark theme" : "Switch to light theme",
      );
      await expect
        .poll(() =>
          page.getByTestId("canvas-wrap").evaluate((wrap) => {
            const ctx = document.createElement("canvas").getContext("2d");
            if (!ctx) throw new Error("Missing colour context");
            const rgb = (color: string) => {
              ctx.clearRect(0, 0, 1, 1);
              ctx.fillStyle = color;
              ctx.fillRect(0, 0, 1, 1);
              return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
            };
            const luminance = (channels: number[]) =>
              channels
                .map((v) => {
                  const c = v / 255;
                  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
                })
                .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
            return [
              ...wrap.querySelectorAll('[data-testid^="group-label-"], [data-testid^="annotation-text-caption-"]'),
            ]
              .map((el) => {
                let bg = getComputedStyle(el).backgroundColor;
                for (let p = el.parentElement; p && bg === "rgba(0, 0, 0, 0)"; p = p.parentElement)
                  bg = getComputedStyle(p).backgroundColor;
                const a = luminance(rgb(getComputedStyle(el).color)),
                  b = luminance(rgb(bg));
                return { id: el.getAttribute("data-testid"), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
              })
              .filter(({ ratio }) => ratio < 4.5);
          }),
        )
        .toEqual([]);
      await expect(
        page.getByTestId(theme === "light" ? "annotation-text-caption-2" : "annotation-text-caption-1"),
      ).toHaveCSS("color", theme === "light" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)");
      if (theme === "light") await page.getByTestId("theme-toggle").click();
    }
  });
}

test("annotation drag previews and settles membership consistently", async ({ page, consoleErrors }) => {
  await seed(page, nestedFixture);
  const note = await page.getByTestId("annotation-note").boundingBox();
  const boundary = await page.getByTestId("group-grp-core").boundingBox();
  if (!note || !boundary) throw new Error("Missing drag geometry");
  await page.mouse.move(note.x + note.width / 2, note.y + note.height / 2);
  await page.mouse.down();
  await page.mouse.move(boundary.x - 40, note.y + note.height / 2, { steps: 10 });
  await expect(page.getByTestId("group-child")).toHaveAttribute("data-membership", "leave");
  await page.mouse.up();
  await page.getByTestId("annotation-note").click();
  await expect(page.getByTestId("inspector-field-group")).toHaveValue("");
  expectNoErrors(consoleErrors);
});

test("selected descendants keep their parent through an unselected intermediate boundary", async ({
  page,
  consoleErrors,
}) => {
  await seed(page, {
    ...nestedFixture,
    // Explicit membership can outlive geometry. Carrying the parent must not re-settle its descendants.
    nodes: nestedFixture.nodes.map((n) => ({ ...n, x: 600 })),
    annotations: nestedFixture.annotations?.map((a) => ({ ...a, x: 610 })),
  });
  await page.getByTestId("group-label-grp-core").click();
  await page.getByTestId("node-member").click({ modifiers: ["Shift"] });
  await page.getByTestId("annotation-note").click({ modifiers: ["Shift"] });
  await waitForStableViewport(page);
  const moved = ["group-grp-core", "node-member", "annotation-note"].map((id) => page.getByTestId(id));
  const before = await Promise.all(moved.map(boxOf));
  const handle = await boxOf(page.getByTestId("group-label-grp-core"));
  const x = handle.x + handle.width / 2,
    y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 10 });
  await page.mouse.up();
  await expect(async () => {
    const after = await Promise.all(moved.map(boxOf));
    const dx = after[0].x - before[0].x,
      dy = after[0].y - before[0].y;
    expect(dx).toBeGreaterThan(0);
    for (let i = 1; i < moved.length; i++) {
      expect(after[i].x - before[i].x).toBeCloseTo(dx, 0);
      expect(after[i].y - before[i].y).toBeCloseTo(dy, 0);
    }
  }).toPass();
  for (const id of ["node-member", "annotation-note"]) {
    await page.keyboard.press("Escape");
    await page.getByTestId(id).click();
    await expect(page.getByTestId("inspector-field-group")).toHaveValue("child");
  }
  expectNoErrors(consoleErrors);
});
