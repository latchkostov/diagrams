import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, gotoCanvas, publicExamples, expectNoErrors, pageLoadTimeout } from "./fixtures";

// Password links (#e=v1.<salt>.<iv>.<ciphertext>, src/interop/shareCrypto.ts). Selectors are data-testid only.

const PASSWORD = "plum orbit lantern 42";
const WRONG = "plum orbit lantern 24";

/** Everything the browser sends: each request's URL, body and headers, from every page in the context. */
function recordRequests(context: BrowserContext) {
  const sent: { url: string; body: string; headers: string }[] = [];
  context.on("request", (r) =>
    sent.push({ url: r.url(), body: r.postData() ?? "", headers: JSON.stringify(r.headers()) }),
  );
  return sent;
}

type CryptoStep = "encrypt" | "decrypt";
interface Gate {
  hold: Partial<Record<CryptoStep, boolean>>;
  held: Partial<Record<CryptoStep, number>>;
  release: Partial<Record<CryptoStep, (() => void)[]>>;
}
declare global {
  interface Window {
    __gate: Gate;
    __blockShared?: boolean;
  }
}

/**
 * Lets a test hold WebCrypto's AES step (after PBKDF2) until it says so, in every page of the context, and
 * make storing the Shared slot fail (as a full or blocked localStorage does).
 */
async function controlCrypto(context: BrowserContext) {
  await context.addInitScript(() => {
    const gate: Gate = { hold: {}, held: {}, release: {} };
    window.__gate = gate;
    for (const step of ["encrypt", "decrypt"] as const) {
      const original = crypto.subtle[step].bind(crypto.subtle) as (...a: unknown[]) => Promise<ArrayBuffer>;
      Object.defineProperty(crypto.subtle, step, {
        configurable: true,
        value: async (...args: unknown[]) => {
          if (gate.hold[step]) {
            gate.held[step] = (gate.held[step] ?? 0) + 1;
            await new Promise<void>((resolve) => (gate.release[step] ??= []).push(resolve));
          }
          return original(...args);
        },
      });
    }
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (window.__blockShared && key === "diagrams.shared.v1") throw new DOMException("full", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
}
const hold = (page: Page, step: CryptoStep) => page.evaluate((s) => void (window.__gate.hold[s] = true), step);
const held = (page: Page, step: CryptoStep) => page.evaluate((s) => window.__gate.held[s] ?? 0, step);
const release = (page: Page, step: CryptoStep) =>
  page.evaluate((s) => {
    window.__gate.hold[s] = false;
    for (const go of window.__gate.release[s]?.splice(0) ?? []) go();
  }, step);

async function makePasswordLink(page: Page, slug: string): Promise<string> {
  await gotoCanvas(page, slug);
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-share-link-password").click();
  const dialog = page.getByTestId("password-link-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("password-link-note")).toContainText("Send the password separately");
  await expect(page.getByTestId("password-link-note")).toContainText(
    "Anyone with the link and the password can open it.",
  );
  // Too short: no link yet.
  await page.getByTestId("password-link-input").fill("short");
  await expect(page.getByTestId("password-link-strength")).toHaveAttribute("data-level", "short");
  await expect(page.getByTestId("password-link-copy")).toBeDisabled();
  await page.getByTestId("password-link-input").fill("password1");
  await expect(page.getByTestId("password-link-strength")).toHaveAttribute("data-level", "weak");
  await page.getByTestId("password-link-input").fill(PASSWORD);
  await expect(page.getByTestId("password-link-strength")).toHaveAttribute("data-level", "strong");
  await page.getByTestId("password-link-copy").click();
  const url = page.getByTestId("password-link-url");
  await expect(url).toHaveValue(/#e=v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/, { timeout: 15_000 });
  return url.inputValue();
}

test.describe("password links", () => {
  test("open with a password: wrong, then right; the fragment is cleared and nothing is sent", async ({
    page,
    context,
    consoleErrors,
  }) => {
    test.slow(); // PBKDF2 at 600,000 iterations, three times
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const sent = recordRequests(context);
    const ex = publicExamples[1];
    const link = await makePasswordLink(page, ex.slug);
    const token = link.split("#e=")[1];
    const ciphertext = token.split(".")[3];
    // The diagram's words never appear in the link.
    expect(link).not.toContain(encodeURIComponent(ex.title));

    const other = await context.newPage();
    await other.goto(link);
    const prompt = other.getByTestId("password-prompt");
    await expect(prompt).toBeVisible({ timeout: pageLoadTimeout() });
    // Wrong password: a clear error, and the prompt stays for another try.
    await other.getByTestId("password-prompt-input").fill(WRONG);
    await other.getByTestId("password-prompt-submit").click();
    await expect(other.getByTestId("password-prompt-error")).toContainText("doesn't open this link", {
      timeout: 15_000,
    });
    await expect(prompt).toBeVisible();
    await expect(other.getByTestId("shared-banner")).toHaveCount(0);
    // Right password: it opens like any shared diagram.
    await other.getByTestId("password-prompt-input").fill(PASSWORD);
    await other.getByTestId("password-prompt-submit").click();
    await expect(prompt).toHaveCount(0, { timeout: 15_000 });
    await expect(other.getByTestId("shared-banner")).toBeVisible();
    await expect(other.getByTestId("example-picker")).toHaveValue("shared");
    await expect(other.getByTestId("diagram-title")).toHaveText(ex.title);
    for (const id of ex.nodeIds) await expect(other.getByTestId(`node-${id}`)).toBeVisible();
    for (const id of ex.edgeIds) await expect(other.getByTestId(`edge-${id}`)).toBeAttached();

    // The ciphertext is gone from the address bar (and this tab's history entry).
    await expect(other).not.toHaveURL(/#e=/);
    expect(await other.evaluate(() => window.location.hash)).toBe("");

    // Nothing that left the browser carries the ciphertext or the password. (A fragment is never sent:
    // Playwright reports the navigation's URL with it, so the part after "#" is dropped here.)
    expect(sent.length).toBeGreaterThan(0);
    for (const r of sent) {
      const onWire = `${r.url.split("#")[0]}\n${r.body}\n${r.headers}`;
      for (const secret of [token, ciphertext, ciphertext.slice(0, 32), PASSWORD, encodeURIComponent(PASSWORD)])
        expect(onWire, `request to ${r.url.split("#")[0]}`).not.toContain(secret);
    }
    expectNoErrors(consoleErrors);
  });

  test("cancelling keeps the link, and an embed asks for the password too", async ({ page, context }) => {
    test.slow();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const ex = publicExamples[0];
    const link = await makePasswordLink(page, ex.slug);
    const token = link.split("#e=")[1];

    const other = await context.newPage();
    await other.goto(link);
    await expect(other.getByTestId("password-prompt")).toBeVisible({ timeout: pageLoadTimeout() });
    await other.getByTestId("password-prompt-cancel").click();
    await expect(other.getByTestId("password-prompt")).toHaveCount(0);
    // Not opened: the fragment stays, so a reload asks again.
    await expect(other).toHaveURL(/#e=v1\./);
    await other.reload();
    await expect(other.getByTestId("password-prompt")).toBeVisible({ timeout: pageLoadTimeout() });

    // The embed viewer prompts inside the frame and keeps its fragment (the frame must stay reloadable).
    const embed = await context.newPage();
    await embed.goto(`./?embed=1#e=${token}`);
    await expect(embed.getByTestId("embed-view")).toBeVisible();
    await expect(embed.getByTestId("password-prompt")).toBeVisible();
    await embed.getByTestId("password-prompt-cancel").click();
    await expect(embed.getByTestId("embed-locked")).toBeVisible();
    await embed.getByTestId("embed-unlock").click();
    await embed.getByTestId("password-prompt-input").fill(WRONG);
    await embed.getByTestId("password-prompt-input").press("Enter");
    await expect(embed.getByTestId("password-prompt-error")).toBeVisible({ timeout: 15_000 });
    await embed.getByTestId("password-prompt-input").fill(PASSWORD);
    await embed.getByTestId("password-prompt-input").press("Enter");
    await expect(embed.getByTestId(`node-${ex.nodeIds[0]}`)).toBeVisible({ timeout: 15_000 });
    await expect(embed.getByTestId("topbar")).toHaveCount(0);
    await expect(embed.getByTestId("embed-open-in-app")).toHaveAttribute("href", new RegExp(`#e=${token}$`));
  });

  test("a damaged or newer-version link says so without asking for a password", async ({ page }) => {
    await page.goto("./#e=v9.AAAA.BBBB.CCCC");
    await expect(page.getByTestId("toast")).toContainText("newer version", { timeout: pageLoadTimeout() });
    await expect(page.getByTestId("password-prompt")).toHaveCount(0);
    await page.goto("./?view=gallery#e=v1.not-a-link");
    await expect(page.getByTestId("toast")).toContainText("damaged or incomplete", { timeout: pageLoadTimeout() });
    await expect(page.getByTestId("password-prompt")).toHaveCount(0);
  });

  test("editing the password while it encrypts never shows or copies the old password's link", async ({
    page,
    context,
  }) => {
    test.slow();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await controlCrypto(context);
    const ex = publicExamples[0];
    await gotoCanvas(page, ex.slug);
    await page.evaluate(() => navigator.clipboard.writeText("before"));
    await page.getByTestId("file-button").click();
    await page.getByTestId("export-share-link-password").click();
    await hold(page, "encrypt");
    await page.getByTestId("password-link-input").fill("first password here");
    await page.getByTestId("password-link-copy").click();
    await expect(page.getByTestId("password-link-copy")).toBeDisabled();
    await expect.poll(() => held(page, "encrypt"), { timeout: 15_000 }).toBe(1);
    // Changed mid-encryption: the pending link (for the first password) is stale.
    await page.getByTestId("password-link-input").fill(PASSWORD);
    await release(page, "encrypt");
    await page.waitForTimeout(500);
    await expect(page.getByTestId("password-link-url")).toHaveCount(0);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("before");
    // The link made now is the current password's, and it opens with it.
    await page.getByTestId("password-link-copy").click();
    const link = await page.getByTestId("password-link-url").inputValue({ timeout: 15_000 });
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    const other = await context.newPage();
    await other.goto(link);
    await other.getByTestId("password-prompt-input").fill(PASSWORD);
    await other.getByTestId("password-prompt-submit").click();
    await expect(other.getByTestId("diagram-title")).toHaveText(ex.title, { timeout: 15_000 });
  });

  test("an unlock that finishes after Cancel, Esc or a newer link opens nothing", async ({ page, context }) => {
    test.slow();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await controlCrypto(context);
    const link = await makePasswordLink(page, publicExamples[0].slug);
    const token = link.split("#e=")[1];

    const other = await context.newPage();
    await other.goto(link);
    await expect(other.getByTestId("password-prompt")).toBeVisible({ timeout: pageLoadTimeout() });
    const before = await other.getByTestId("example-picker").inputValue();
    for (const close of ["cancel", "escape"] as const) {
      if (close === "escape") {
        await other.reload();
        await expect(other.getByTestId("password-prompt")).toBeVisible({ timeout: pageLoadTimeout() });
      }
      await hold(other, "decrypt");
      await other.getByTestId("password-prompt-input").fill(PASSWORD);
      await other.getByTestId("password-prompt-submit").click();
      await expect.poll(() => held(other, "decrypt"), { timeout: 15_000 }).toBeGreaterThan(0);
      if (close === "cancel") await other.getByTestId("password-prompt-cancel").click();
      else await other.getByTestId("password-prompt-input").press("Escape");
      await expect(other.getByTestId("password-prompt")).toHaveCount(0);
      await release(other, "decrypt");
      await other.waitForTimeout(500);
      await expect(other.getByTestId("shared-banner")).toHaveCount(0);
      await expect(other.getByTestId("example-picker")).toHaveValue(before);
      await expect(other, "the link stays, so a reload asks again").toHaveURL(/#e=v1\./);
    }

    // A newer link replaces the prompt; the older unlock finishing later doesn't close or open anything.
    await other.reload();
    await expect(other.getByTestId("password-prompt")).toBeVisible({ timeout: pageLoadTimeout() });
    await hold(other, "decrypt");
    await other.getByTestId("password-prompt-input").fill(PASSWORD);
    await other.getByTestId("password-prompt-submit").click();
    await expect.poll(() => held(other, "decrypt"), { timeout: 15_000 }).toBeGreaterThan(0);
    const [v, salt, iv, ct] = token.split(".");
    const newer = [v, salt, iv, `${ct.slice(0, -2)}AA`].join(".");
    await other.evaluate((t) => (window.location.hash = `e=${t}`), newer);
    await expect(other.getByTestId("password-prompt-input")).toHaveValue("");
    await release(other, "decrypt");
    await other.waitForTimeout(500);
    await expect(other.getByTestId("password-prompt")).toBeVisible();
    await expect(other.getByTestId("shared-banner")).toHaveCount(0);
    await expect(other).toHaveURL(new RegExp(`#e=${newer}$`));

    // The embed viewer: Cancel during an unlock leaves it locked.
    const embed = await context.newPage();
    await embed.goto(`./?embed=1#e=${token}`);
    await expect(embed.getByTestId("password-prompt")).toBeVisible({ timeout: pageLoadTimeout() });
    await hold(embed, "decrypt");
    await embed.getByTestId("password-prompt-input").fill(PASSWORD);
    await embed.getByTestId("password-prompt-submit").click();
    await expect.poll(() => held(embed, "decrypt"), { timeout: 15_000 }).toBeGreaterThan(0);
    await embed.getByTestId("password-prompt-cancel").click();
    await release(embed, "decrypt");
    await embed.waitForTimeout(500);
    await expect(embed.getByTestId("embed-locked")).toBeVisible();
    await expect(embed.getByTestId(`node-${publicExamples[0].nodeIds[0]}`)).toHaveCount(0);
  });

  test("an unlock that finishes while the diagram asked for still downloads never replaces it", async ({
    page,
    context,
  }) => {
    test.slow();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await controlCrypto(context);
    const link = await makePasswordLink(page, publicExamples[0].slug);
    const target = publicExamples[2];

    const other = await context.newPage();
    // Hold the target example's download: the picker shows it at once, the canvas only once it arrives.
    let requested = false;
    let arrive!: () => void;
    const arrived = new Promise<void>((resolve) => (arrive = resolve));
    await other.route(
      new RegExp(String.raw`/(?:assets/${target.slug}-[A-Za-z0-9_-]+\.js|src/examples/${target.slug}\.json)(?:\?.*)?$`),
      async (route) => {
        requested = true;
        await arrived;
        await route.continue();
      },
    );
    await other.goto(link);
    await expect(other.getByTestId("password-prompt")).toBeVisible({ timeout: pageLoadTimeout() });
    await hold(other, "decrypt");
    await other.getByTestId("password-prompt-input").fill(PASSWORD);
    await other.getByTestId("password-prompt-submit").click();
    await expect.poll(() => held(other, "decrypt"), { timeout: 15_000 }).toBeGreaterThan(0);
    await other.evaluate((slug) => {
      history.pushState(null, "", `?view=canvas&example=${slug}${location.hash}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, target.slug);
    await expect(other.getByTestId("example-picker")).toHaveValue(target.slug);
    await expect.poll(() => requested).toBe(true);

    // The unlock finishes first: it says so and opens nothing.
    await release(other, "decrypt");
    await expect(other.getByTestId("password-prompt-error")).toContainText("Another diagram opened", {
      timeout: 15_000,
    });
    await expect(other.getByTestId("shared-banner")).toHaveCount(0);
    await expect(other.getByTestId("example-picker")).toHaveValue(target.slug);

    // Then the diagram asked for arrives, and stays.
    arrive();
    await expect(other.getByTestId("diagram-title")).toHaveText(target.title, { timeout: pageLoadTimeout() });
    await expect(other.getByTestId("shared-banner")).toHaveCount(0);
  });

  test("moving to another diagram during an unlock drops its result", async ({ page, context }) => {
    test.slow();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await controlCrypto(context);
    const link = await makePasswordLink(page, publicExamples[0].slug);
    const target = publicExamples[2];

    const other = await context.newPage();
    await other.goto(link);
    await expect(other.getByTestId("password-prompt")).toBeVisible({ timeout: pageLoadTimeout() });
    await hold(other, "decrypt");
    await other.getByTestId("password-prompt-input").fill(PASSWORD);
    await other.getByTestId("password-prompt-submit").click();
    await expect.poll(() => held(other, "decrypt"), { timeout: 15_000 }).toBeGreaterThan(0);
    // Back/forward to another diagram (the app follows popstate).
    await other.evaluate((slug) => {
      history.pushState(null, "", `?view=canvas&example=${slug}${location.hash}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, target.slug);
    await expect(other.getByTestId("example-picker")).toHaveValue(target.slug);
    // The picker shows a pending choice at once; the diagram opens once its example has downloaded (slow under load).
    await expect(other.getByTestId("diagram-title")).toHaveText(target.title, { timeout: pageLoadTimeout() });
    await release(other, "decrypt");
    await expect(other.getByTestId("password-prompt-error")).toContainText("Another diagram opened", {
      timeout: 15_000,
    });
    await expect(other.getByTestId("shared-banner")).toHaveCount(0);
    await expect(other.getByTestId("example-picker")).toHaveValue(target.slug);
    await expect(other).toHaveURL(/#e=v1\./);
  });

  test("if the diagram can't be stored, the prompt says why and keeps the link for a retry", async ({
    page,
    context,
  }) => {
    test.slow();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await controlCrypto(context);
    const ex = publicExamples[1];
    const link = await makePasswordLink(page, ex.slug);

    const other = await context.newPage();
    await other.goto(link);
    await expect(other.getByTestId("password-prompt")).toBeVisible({ timeout: pageLoadTimeout() });
    const before = await other.getByTestId("example-picker").inputValue();
    await other.evaluate(() => (window.__blockShared = true));
    await other.getByTestId("password-prompt-input").fill(PASSWORD);
    await other.getByTestId("password-prompt-submit").click();
    await expect(other.getByTestId("password-prompt-error")).toBeVisible({ timeout: 15_000 });
    await expect(other.getByTestId("password-prompt")).toBeVisible();
    await expect(other).toHaveURL(/#e=v1\./);
    await expect(other.getByTestId("shared-banner")).toHaveCount(0);
    await expect(other.getByTestId("example-picker")).toHaveValue(before);
    // Storage recovers: the same prompt opens it.
    await other.evaluate(() => (window.__blockShared = false));
    await other.getByTestId("password-prompt-submit").click();
    await expect(other.getByTestId("password-prompt")).toHaveCount(0, { timeout: 15_000 });
    await expect(other.getByTestId("diagram-title")).toHaveText(ex.title);
    await expect(other).not.toHaveURL(/#e=/);
  });

  test("the share dialogs keep every action inside the dialog at 1024 px, at 320 px and in a small embed", async ({
    page,
    context,
  }) => {
    test.slow();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    // Native Share adds a fourth footer action where the browser has it.
    await context.addInitScript(() => Object.assign(navigator, { share: async () => {} }));
    const inside = async (dialog: string, ids: string[]) => {
      const box = await page.getByTestId(dialog).boundingBox();
      const viewport = page.viewportSize();
      if (!box || !viewport) throw new Error("no dialog box");
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
      for (const id of ids) {
        const b = await page.getByTestId(id).boundingBox();
        if (!b) throw new Error(`${id} has no box`);
        expect(b.x, id).toBeGreaterThanOrEqual(box.x - 0.5);
        expect(b.x + b.width, id).toBeLessThanOrEqual(box.x + box.width + 0.5);
        expect(b.y + b.height, id).toBeLessThanOrEqual(box.y + box.height + 0.5);
      }
    };
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoCanvas(page, publicExamples[1].slug);
    await page.getByTestId("file-button").click();
    await page.getByTestId("export-share-link").click();
    await page.getByTestId("toast-share-details").click();
    const share = ["share-link-native", "share-link-password", "share-link-open", "share-link-copy"];
    await expect(page.getByTestId("share-link-copy")).toBeEnabled();
    await inside("share-link-dialog", share);
    await page.setViewportSize({ width: 320, height: 640 });
    await inside("share-link-dialog", share);
    await page.getByTestId("share-link-password").click();
    await page.getByTestId("password-link-input").fill(PASSWORD);
    await inside("password-link-dialog", ["password-link-show", "password-link-cancel", "password-link-copy"]);
    await page.getByTestId("password-link-copy").click();
    const link = await page.getByTestId("password-link-url").inputValue({ timeout: 15_000 });
    await inside("password-link-dialog", ["password-link-copy-again", "password-link-done"]);

    // A short embed frame.
    await page.setViewportSize({ width: 320, height: 300 });
    await page.goto(`./?embed=1#e=${link.split("#e=")[1]}`);
    await expect(page.getByTestId("password-prompt")).toBeVisible({ timeout: pageLoadTimeout() });
    await inside("password-prompt", ["password-prompt-input", "password-prompt-cancel", "password-prompt-submit"]);
    const submit = await page.getByTestId("password-prompt-submit").boundingBox();
    expect((submit?.y ?? 999) + (submit?.height ?? 0)).toBeLessThanOrEqual(300);
  });
});
