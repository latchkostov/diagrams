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
});
