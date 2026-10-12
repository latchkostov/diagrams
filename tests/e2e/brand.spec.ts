import { test, expect, expectNoErrors } from "./fixtures";

// What OAuth brand reviewers (Google, Microsoft, Dropbox) check on the home page, without signing in: the app
// name exactly as on the consent screen, what the app does, and a visible link to the privacy policy on the same
// site, which carries Google's Limited Use disclosure. Google compares the names, so they must match exactly.
// Selectors are data-testid only.

const NAME = "Live Diagrams";
const LIMITED_USE =
  "Live Diagrams' use and transfer of information received from Google APIs to any other app will adhere to the " +
  "Google API Services User Data Policy, including the Limited Use requirements.";

test.describe("brand verification", () => {
  test("the home page names the app, says what it is and links the privacy policy", async ({
    page,
    context,
    consoleErrors,
  }) => {
    await page.goto("./");
    await expect(page).toHaveTitle(NAME);
    await expect(page.getByTestId("brand")).toHaveText(NAME);
    const about = page.getByTestId("start-about");
    await expect(about).toBeVisible();
    await expect(about).toContainText(`${NAME} is a free, open-source diagram tool that runs in your browser.`);

    const privacy = page.getByTestId("start-privacy");
    await expect(privacy).toBeVisible();
    await expect(privacy).toHaveAttribute("href", "privacy.html");
    const [policy] = await Promise.all([context.waitForEvent("page"), privacy.click()]);
    await policy.waitForLoadState();
    expect(new URL(policy.url()).pathname).toMatch(/\/privacy\.html$/);
    await expect(policy).toHaveTitle(`Privacy policy · ${NAME}`);
    await expect(policy.getByTestId("privacy-effective")).toContainText(NAME);
    await expect(policy.getByTestId("limited-use")).toHaveText(LIMITED_USE);
    await expect(policy.getByTestId("limited-use").getByRole("link")).toHaveAttribute(
      "href",
      "https://developers.google.com/terms/api-services-user-data-policy",
    );
    await expect(policy.getByTestId("privacy-contact")).toHaveAttribute("href", "mailto:latch.kostov@gmail.com");
    for (const id of ["revoke-google", "revoke-microsoft", "revoke-dropbox"])
      await expect(policy.getByTestId(id)).toBeVisible();

    await expect(page.getByTestId("start-terms")).toHaveAttribute("href", "terms.html");
    await page.goto("./terms.html");
    await expect(page.getByTestId("terms-title")).toBeVisible();
    await expect(page).toHaveTitle(`Terms of use · ${NAME}`);
    expectNoErrors(consoleErrors);
  });

  test("crawlers that don't run JavaScript see the name, the description and the policy links", async ({ page }) => {
    const html = await (await page.request.get("./")).text();
    expect(html).toContain(`<title>${NAME}</title>`);
    expect(html).toMatch(/<meta\s+name="description"\s+content="Live Diagrams is a free, open-source tool/);
    expect(html).toContain(`<meta property="og:site_name" content="${NAME}" />`);
    expect(html).toMatch(/<h1>[^<]*<img [^>]*\/>Live Diagrams<\/h1>/);
    expect(html).toContain('href="./privacy.html"');
    expect(html).toContain('href="./terms.html"');
    const policy = await (await page.request.get("./privacy.html")).text();
    expect(policy.replace(/\s+/g, " ").replace(/<[^>]+>/g, "")).toContain(LIMITED_USE);
  });

  test("at 1024 px the start card's footer shows without scrolling and the top bar fits", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("./");
    const card = page.getByTestId("start-card");
    await expect(card).toBeVisible();
    // Nothing to scroll to: the footer is in the card's visible box.
    const bottom = (el: Element) => el.getBoundingClientRect().bottom;
    const cardBottom = await card.evaluate(bottom);
    expect(await page.getByTestId("start-about").evaluate(bottom)).toBeLessThanOrEqual(cardBottom);
    const overflow = await page.getByTestId("topbar").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
