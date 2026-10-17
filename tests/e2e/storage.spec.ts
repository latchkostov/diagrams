import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, publicExamples, expectNoErrors } from "./fixtures";

// Storage providers (src/interop/storage). Real cloud providers need accounts, so these tests use the
// dev-only fake provider ("Test storage", `?storage=test`), which keeps files in localStorage and goes
// through exactly the same menus, dialog, bindings and status as Google Drive, OneDrive and Dropbox.

const TEST_FILES = "diagrams.test-storage.v1";
const FAIL = "diagrams.test-storage.fail";

interface TestFile {
  id: string;
  name: string;
  text: string;
}

const files = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]") as TestFile[], TEST_FILES);

async function openMenu(page: Page) {
  await page.getByTestId("file-button").click();
  await expect(page.getByTestId("file-menu")).toBeVisible();
}

async function submenuItem(page: Page, parent: "file-open-from" | "file-save-to", item: string) {
  await openMenu(page);
  await page.getByTestId(parent).click();
  await expect(page.getByTestId(`${parent}-menu`)).toBeVisible();
  await page.getByTestId(item).click();
}

async function gotoWithTestStorage(page: Page, slug = publicExamples[0].slug) {
  await page.goto(`./?view=canvas&example=${encodeURIComponent(slug)}&storage=test`);
  await expect(page.getByTestId("canvas-view")).toBeVisible();
}

async function setTitle(page: Page, title: string) {
  await page.getByTestId("inspector-toggle").click();
  await page.getByTestId("inspector-field-title").fill(title);
  await page.getByTestId("inspector-toggle").click();
  await expect(page.getByTestId("diagram-title")).toHaveText(title);
}

test.describe("storage providers", () => {
  test("with nothing configured, every cloud entry is hidden and nothing is loaded", async ({
    page,
    consoleErrors,
  }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await gotoCanvas(page, publicExamples[0].slug);
    await openMenu(page);
    const menu = page.getByTestId("file-menu");
    await expect(menu.getByTestId("file-open")).toBeVisible();
    await expect(menu.getByTestId("file-save")).toBeVisible();
    await expect(menu.getByTestId("file-open-from")).toHaveCount(0);
    await expect(menu.getByTestId("file-save-to")).toHaveCount(0);
    await expect(page.getByTestId("save-status")).toHaveCount(0);
    await page.keyboard.press("Escape");
    // No provider module was fetched (dev serves each as its own file).
    expect(requests.filter((u) => /\/interop\/storage\/(gdrive|onedrive|dropbox|oauth|testProvider)/.test(u))).toEqual(
      [],
    );
    expect(requests.filter((u) => !u.startsWith("http://localhost"))).toEqual([]);
    expectNoErrors(consoleErrors);
  });

  test("Save to ▸, Save and Open from ▸ round-trip, and the status says where it went", async ({
    page,
    consoleErrors,
  }) => {
    await gotoWithTestStorage(page);
    await openMenu(page);
    await page.getByTestId("file-open-from").click();
    const openFrom = page.getByTestId("file-open-from-menu");
    await expect(openFrom.getByTestId("open-from-device")).toBeVisible();
    await expect(openFrom.getByTestId("open-from-test")).toContainText("Test storage");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // Save to ▸ Test storage: a new file, and the diagram is now bound to it.
    await setTitle(page, "Cloud round trip");
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
    const filename = "cloud-round-trip.diagram.json";
    await submenuItem(page, "file-save-to", "save-to-test");
    await expect(page.getByTestId("toast")).toContainText(`Saved to Test storage as ${filename}.`);
    await expect(page.getByTestId("save-status")).toHaveText("Saved to Test storage · just now");
    let stored = await files(page);
    expect(stored.map((f) => f.name)).toEqual([filename]);
    expect(JSON.parse(stored[0].text).title).toBe("Cloud round trip");

    // Save (Ctrl+S) writes over the same file.
    await openMenu(page);
    await expect(page.getByTestId("file-save")).toContainText(`To Test storage: ${filename}`);
    await page.keyboard.press("Escape");
    await setTitle(page, "Cloud round trip, edited");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByTestId("toast")).toContainText("Saved to Test storage");
    await expect.poll(async () => JSON.parse((await files(page))[0].text).title).toBe("Cloud round trip, edited");
    stored = await files(page);
    expect(stored).toHaveLength(1);

    // Open from ▸ Test storage: the in-app list, then the diagram opens bound to that file.
    await submenuItem(page, "file-open-from", "open-from-test");
    const dialog = page.getByTestId("storage-files-dialog");
    await expect(dialog).toContainText("Open from Test storage", { timeout: 20_000 }); // lazy chunk
    await expect(dialog.getByTestId("storage-file-0")).toContainText(filename);
    await dialog.getByTestId("storage-file-0").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("diagram-title")).toHaveText("Cloud round trip, edited");
    await expect(page.getByTestId("save-status")).toHaveText("Opened from Test storage");
    await setTitle(page, "Opened and saved back");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByTestId("save-status")).toHaveText("Saved to Test storage · just now");
    stored = await files(page);
    expect(stored).toHaveLength(1);
    expect(JSON.parse(stored[0].text).title).toBe("Opened and saved back");

    // Save to ▸ again makes a copy; it never overwrites.
    await openMenu(page);
    await page.getByTestId("file-save-to").click();
    await expect(page.getByTestId("save-to-test")).toContainText("Saves a new copy");
    await page.getByTestId("save-to-test").click();
    await expect
      .poll(async () => (await files(page)).map((f) => f.name))
      .toEqual([filename, "opened-and-saved-back.diagram.json"]);
    expectNoErrors(consoleErrors);
  });

  test("a failed save says why and keeps the destination", async ({ page }) => {
    await gotoWithTestStorage(page);
    await submenuItem(page, "file-save-to", "save-to-test");
    await expect(page.getByTestId("save-status")).toContainText("Saved to Test storage");
    await page.evaluate((key) => localStorage.setItem(key, "save"), FAIL);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByTestId("toast")).toHaveAttribute("data-kind", "error");
    await expect(page.getByTestId("toast")).toContainText(
      "Couldn't save to Test storage. Test storage refused to save the file",
    );
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByTestId("toast")).toHaveAttribute("data-kind", "success");
    expect(await files(page)).toHaveLength(1);
  });

  test("a failed cloud open names the provider and keeps the diagram", async ({ page }) => {
    await gotoWithTestStorage(page);
    await submenuItem(page, "file-save-to", "save-to-test");
    await expect(page.getByTestId("save-status")).toContainText("Saved to Test storage");
    const title = await page.getByTestId("diagram-title").textContent();
    await page.evaluate((key) => localStorage.setItem(key, "open"), FAIL);
    await submenuItem(page, "file-open-from", "open-from-test");
    await page.getByTestId("storage-file-0").click();
    await expect(page.getByTestId("toast")).toHaveText(
      "Couldn't open from Test storage. Test storage refused to open the file (a simulated failure).",
    );
    await expect(page.getByTestId("diagram-title")).toHaveText(title ?? "");
  });

  test("an empty folder explains what to do; the list closes with Esc", async ({ page }) => {
    await gotoWithTestStorage(page);
    await submenuItem(page, "file-open-from", "open-from-test");
    const dialog = page.getByTestId("storage-files-dialog");
    // The list is a lazy chunk: allow a cold dev server time to compile it.
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByTestId("storage-files-empty")).toContainText("Save to ▸ Test storage");
    await expect(dialog.getByTestId("storage-privacy")).toHaveAttribute("href", "privacy.html");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("save-status")).toHaveCount(0);
  });

  test("Save to ▸ This device is Save as, and the status names this device", async ({ page }) => {
    await page.addInitScript(() => {
      const handle = {
        kind: "file",
        name: "picked.diagram.json",
        getFile: async () => new File([], "picked.diagram.json"),
        queryPermission: async () => "granted",
        createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      };
      Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: async () => handle });
      Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: async () => [handle] });
    });
    await gotoWithTestStorage(page);
    await submenuItem(page, "file-save-to", "save-to-device");
    await expect(page.getByTestId("toast")).toContainText("Saved to picked.diagram.json");
    await expect(page.getByTestId("save-status")).toHaveText("Saved to this device · just now");
    await expect(page.getByTestId("save-status")).toHaveAttribute("title", /picked\.diagram\.json/);
  });
});

test("the shortcuts dialog links the privacy page, which loads", async ({ page }) => {
  await gotoCanvas(page, publicExamples[0].slug);
  await page.getByTestId("canvas-wrap").click({ position: { x: 700, y: 60 } });
  await page.keyboard.press("?");
  await expect(page.getByTestId("shortcuts-dialog")).toBeVisible();
  const link = page.getByTestId("privacy-link");
  await expect(link).toHaveAttribute("href", "privacy.html");
  const res = await page.request.get("./privacy.html");
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain("No analytics");
});

test("pending Save follows the first promoted copy (test cloud)", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(
    /\/(?:assets\/testProvider-[\w-]+\.js|src\/interop\/storage\/testProvider\.ts)(?:\?.*)?$/,
    async (route) => {
      requested = true;
      await held;
      await route.continue();
    },
  );
  try {
    await gotoWithTestStorage(page, "kafka-order-pipeline");
    await submenuItem(page, "file-save-to", "save-to-test");
    await expect.poll(() => requested).toBe(true);
    await page.getByTestId("node-shopper").click();
    await page.getByTestId("inspector-field-label").fill("Promoted storefront");
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
    release();
    await expect(page.getByTestId("save-status")).toContainText("Test storage");
    await expect.poll(async () => (await files(page)).length).toBe(1);
    const id = (await files(page))[0].id;
    await page.keyboard.press("ControlOrMeta+s");
    await expect
      .poll(
        async () => JSON.parse((await files(page))[0].text).nodes.find((n: { id: string }) => n.id === "shopper").label,
      )
      .toBe("Promoted storefront");
    expect((await files(page)).map((f) => f.id)).toEqual([id]);
  } finally {
    release();
  }
});
