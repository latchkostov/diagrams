import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, pageLoadTimeout, pauseClock } from "./fixtures";
import en from "../../src/i18n/en";
import { compile } from "../../src/i18n/icu";
import { parse } from "../../src/i18n/icu";
import { pseudoLocalize } from "../../src/i18n/pseudo";

const codes = readdirSync(join(process.cwd(), "src/i18n/locales"))
  .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
  .map((f) => f.slice(0, -5));
const words = (code: string, key: keyof typeof en) => {
  if (code === "en") return en[key];
  if (code === "en-XA") {
    // Same trusted build-time compiler used by the catalog tests, not browser code.
    return JSON.parse(compile(pseudoLocalize(parse(en[key])))) as string;
  }
  return (
    JSON.parse(readFileSync(join(process.cwd(), "src/i18n/locales", `${code}.json`), "utf8")) as Record<string, string>
  )[key];
};

// Authored commands are an independent baseline: never derive expectations from translated DOM.
const commands = {
  marketplace: "/plugin marketplace add latchkostov/diagrams",
  install: "/plugin install livediagrams@livediagrams",
  codex:
    "curl -LO https://www.livediagrams.dev/livediagrams-skill.zip && unzip livediagrams-skill.zip -d ~/.agents/skills/",
  "codex-windows":
    'iwr https://www.livediagrams.dev/livediagrams-skill.zip -OutFile livediagrams-skill.zip; Expand-Archive livediagrams-skill.zip "$HOME\\.agents\\skills"',
};

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

async function translatedProse(page: Page, code: string) {
  const body = normalize(
    await page.getByTestId("skill-title").evaluate((title) => title.parentElement?.textContent ?? ""),
  );
  const slots: Partial<Record<keyof typeof en, Record<string, string>>> = {
    "staticSkill.intro": { skill: "livediagrams", file: ".diagram.json" },
    "staticSkill.html": { label: words(code, "staticSkill.htmlLabel") },
    "staticSkill.diagram": { label: words(code, "staticSkill.diagramLabel"), file: ".diagram.json" },
    "staticSkill.image": { label: words(code, "staticSkill.imageLabel") },
    "staticSkill.link": { label: words(code, "staticSkill.linkLabel") },
    "staticSkill.upload": { zip: "livediagrams-skill.zip", settings: words(code, "staticSkill.settings") },
    "staticSkill.unzip": { personal: "~/.agents/skills/", repo: ".agents/skills/" },
    "staticSkill.other": { folder: "livediagrams/", skill: "SKILL.md" },
  };
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    if (!key.startsWith("staticSkill.") || /\.(?:description|copied|selectCopy)$/.test(key)) continue;
    const expected = words(code, key).replace(/\{(\w+)\}/g, (_, name: string) => slots[key]?.[name] ?? "");
    expect(body, `${code}: ${key}`).toContain(normalize(expected));
  }
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await page.getByTestId("skill-title").evaluate((title) => {
      const main = title.parentElement;
      if (!main) return false;
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!(node instanceof HTMLElement) || getComputedStyle(node).display === "inline") continue;
        const element = node;
        const rect = element.getBoundingClientRect();
        if (rect.left < 0 || rect.right > innerWidth || element.scrollWidth > element.clientWidth + 1) return false;
      }
      return true;
    }),
  ).toBe(true);
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test.describe(`static pages at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });
    for (const code of ["de", "ar", "en-XA"]) {
      test(`app language choice ${code} follows direct page links`, async ({ page, consoleErrors }, info) => {
        await gotoCanvas(page, "kafka-order-pipeline");
        await page.getByTestId("view-button").click();
        await page.getByTestId("view-language").click();
        await expect(page.getByTestId("language-dialog")).toBeVisible({ timeout: pageLoadTimeout() });
        await page.getByTestId(`language-option-${code}`).click();
        await expect(page.getByTestId(`language-option-${code}`)).toHaveAttribute("aria-checked", "true");
        await page.goto("./skill/");
        await expect(page.getByTestId("skill-title")).toHaveText(words(code, "staticSkill.title"));
        await expect(page.getByTestId("skill-back")).toHaveText(words(code, "staticSkill.back"));
        expect(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir])).toEqual([
          code,
          code === "ar" ? "rtl" : "ltr",
        ]);
        if (code === "ar") {
          await expect(page.getByTestId("skill-back")).toContainText("→");
          await expect(page.getByTestId("skill-cmd-codex")).toHaveAttribute("dir", "ltr");
        }
        await noOverflow(page);
        await page.screenshot({ path: info.outputPath("skill.png"), fullPage: true });
        await page.goto("./auth.html");
        await expect(page.getByTestId("auth-message")).toHaveText(words(code, "staticAuth.nothing"));
        await expect(page).toHaveTitle(words(code, "staticAuth.title"));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath("auth.png") });
        expectNoErrors(consoleErrors);
      });
    }
  });
}

for (const code of codes) {
  test(`both pages open directly in ${code} without catalog downloads`, async ({ page, consoleErrors }) => {
    await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), code);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("./skill/");
    await expect(page.getByTestId("skill-title")).toHaveText(words(code, "staticSkill.title"));
    await expect(page.getByTestId("skill-copy-install")).toHaveText(words(code, "staticSkill.copy"));
    expect(
      await page.getByTestId("skill-title").evaluate(() => {
        const description = [...document.head.children].find(
          (element) => element.getAttribute("name") === "description",
        );
        return description?.getAttribute("content");
      }),
    ).toBe(words(code, "staticSkill.description"));
    await translatedProse(page, code);
    await noOverflow(page);
    await page.goto("./auth.html");
    await expect(page.getByTestId("auth-message")).toHaveText(words(code, "staticAuth.nothing"));
    expect(requests.filter((url) => /\.(?:m?js)(?:\?|$)/.test(url)).map((url) => new URL(url).pathname)).toEqual([
      "/skill/copy.js",
      "/auth.js",
    ]);
    expectNoErrors(consoleErrors);
  });
}

test.describe("browser preference and fallback", () => {
  test.use({ locale: "pt-AO" });
  test("uses the app's regional fallback and ignores an unavailable saved language", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("diagrams.locale", "unavailable"));
    await page.goto("./skill/");
    await expect(page.getByTestId("skill-title")).toHaveText(words("pt-PT", "staticSkill.title"));
    await page.goto("./auth.html");
    await expect(page.getByTestId("auth-message")).toHaveText(words("pt-PT", "staticAuth.nothing"));
  });
});

test.describe("English fallback with storage unavailable", () => {
  test.use({ locale: "sw" });
  test("direct pages use English when no browser language is offered", async ({ page }) => {
    await page.addInitScript(() =>
      Object.defineProperty(window, "localStorage", {
        get: () => {
          throw new Error("blocked");
        },
      }),
    );
    await page.goto("./skill/");
    await expect(page.getByTestId("skill-title")).toHaveText(en["staticSkill.title"]);
    await page.goto("./auth.html");
    await expect(page.getByTestId("auth-message")).toHaveText(en["staticAuth.nothing"]);
  });
});

test("English DOM and delivered HTML match the saved baseline, legal pages stay English", async ({ page, request }) => {
  for (const file of ["skill/index.html", "auth.html", "privacy.html", "terms.html"]) {
    const original = readFileSync(join(process.cwd(), "public", file), "utf8");
    expect(await (await request.get(`./${file}`)).text()).toBe(original);
  }
  await page.goto("./skill/");
  await expect(page.getByTestId("skill-copy-install")).toHaveText("Copy");
  const original = readFileSync(join(process.cwd(), "public/skill/index.html"), "utf8");
  expect(
    await page.evaluate(
      (source) =>
        document.documentElement.outerHTML ===
        new DOMParser().parseFromString(source, "text/html").documentElement.outerHTML,
      original,
    ),
  ).toBe(true);
});

test("saved standalone pages translate offline from file URLs with no requests", async ({ page, request }, info) => {
  const folder = info.outputPath("offline");
  for (const file of ["skill/index.html", "skill/copy.js", "auth.html", "auth.js"]) {
    const path = join(folder, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, await (await request.get(`./${file}`)).body());
  }
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { value: ["de-DE"] });
    Object.defineProperty(window, "localStorage", {
      get: () => {
        throw new Error("blocked");
      },
    });
  });
  await page.context().setOffline(true);
  const network: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  await page.goto(pathToFileURL(join(folder, "skill/index.html")).href);
  await expect(page.getByTestId("skill-title")).toHaveText(words("de", "staticSkill.title"));
  await page.goto(pathToFileURL(join(folder, "auth.html")).href);
  await expect(page.getByTestId("auth-message")).toHaveText(words("de", "staticAuth.nothing"));
  expect(network).toEqual([]);
});

test("copy feedback translates, preserves command bytes, and resets on the fake clock", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("diagrams.locale", "de"));
  await page.clock.install();
  await pauseClock(page);
  await page.goto("./skill/");
  const copy = page.getByTestId("skill-copy-codex-windows");
  await expect(copy).toHaveText(words("de", "staticSkill.copy"));
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (value: string) => {
          sessionStorage.setItem("copied", value);
          return Promise.resolve();
        },
      },
      configurable: true,
    }),
  );
  await copy.click();
  await expect(copy).toHaveText(words("de", "staticSkill.copied"));
  expect(await page.evaluate(() => sessionStorage.getItem("copied"))).toBe(commands["codex-windows"]);
  await page.clock.runFor(2000);
  await expect(copy).toHaveText(words("de", "staticSkill.copy"));
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () => Promise.reject(new Error("denied")),
      },
      configurable: true,
    }),
  );
  await copy.click();
  await expect(copy).toHaveText(words("de", "staticSkill.selectCopy"));
});

for (const error of [false, true]) {
  test(`OAuth ${error ? "error" : "success"} scrubs the query before dispatch and translates each state`, async ({
    page,
  }) => {
    await page.clock.install();
    await pauseClock(page);
    await page.addInitScript(() => {
      localStorage.setItem("diagrams.locale", "ar");
      window.close = () => {};
      Object.defineProperty(window, "BroadcastChannel", {
        value: class {
          postMessage(value: unknown) {
            sessionStorage.setItem("oauth", JSON.stringify({ value, search: location.search }));
          }
          close() {}
        },
      });
    });
    await page.goto(`./auth.html?state=test-state&${error ? "error=access_denied" : "code=test-code"}`);
    await expect(page.getByTestId("auth-message")).toHaveText(words("ar", "staticAuth.finishing"));
    const dispatched = await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("oauth") ?? "null") as {
          value: { type: string; params: Record<string, string> };
          search: string;
        },
    );
    expect(dispatched.search).toBe("");
    expect(dispatched.value).toEqual({
      type: "diagrams-oauth",
      params: {
        state: "test-state",
        ...(error ? { error: "access_denied" } : { code: "test-code" }),
      },
    });
    await page.clock.runFor(60);
    await expect(page.getByTestId("auth-message")).toHaveText(
      words("ar", error ? "staticAuth.failed" : "staticAuth.signedIn"),
    );
  });
}

for (const code of ["de", "ar", "en-XA"]) {
  test(`translation preserves every install command in ${code}`, async ({ page }) => {
    await page.addInitScript((locale) => {
      localStorage.setItem("diagrams.locale", locale);
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: (text: string) => {
            sessionStorage.setItem("copied", text);
            return Promise.resolve();
          },
        },
      });
    }, code);
    await page.goto("./skill/");
    await expect(page.getByTestId("skill-title")).toHaveText(words(code, "staticSkill.title"));
    for (const [name, expected] of Object.entries(commands)) {
      await expect(page.getByTestId(`skill-cmd-${name}`)).toHaveText(expected);
      await page.getByTestId(`skill-copy-${name}`).click();
      expect(await page.evaluate(() => sessionStorage.getItem("copied"))).toBe(expected);
    }
  });
}

test("translation follows stable blocks and slots after page edits", async ({ page, consoleErrors }) => {
  await page.addInitScript(() => localStorage.setItem("diagrams.locale", "de"));
  await page.route("**/skill/", async (route) => {
    let html = await (await route.fetch()).text();
    html = html.replaceAll(/(<h2[^>]*>[^<]*<\/h2>)/g, "$1<p>Introductory paragraph.</p>");
    html = html.replace(
      /(<ul data-testid="skill-outputs">)([\s\S]*?)(<\/ul>)/,
      (_, open: string, items: string, close: string) =>
        open + (items.match(/<li\b[\s\S]*?<\/li>/g) ?? []).reverse().join("\n") + close,
    );
    // Extra inline nodes must not steal preserved slots, even within the same paragraph.
    html = html.replace(
      'data-testid="skill-intro">',
      'data-testid="skill-intro"><strong>Aside</strong><code>aside</code>',
    );
    await route.fulfill({ contentType: "text/html", body: html });
  });
  await page.goto("./skill/");
  await expect(page.getByTestId("skill-back")).toHaveText(words("de", "staticSkill.back"));
  await translatedProse(page, "de");
  for (const name of ["html", "diagram", "image", "link"] as const) {
    await expect(page.getByTestId(`skill-label-${name}`)).toHaveText(words("de", `staticSkill.${name}Label`));
  }
  await expect(page.getByTestId("skill-intro")).toContainText("livediagrams");
  await expect(page.getByTestId("skill-intro")).toContainText(".diagram.json");
  expectNoErrors(consoleErrors);
});

test("callback reaches the OAuth channel without an opener", async ({ page, context }) => {
  await page.goto("./auth.html");
  await page.evaluate(() => {
    const channel = new BroadcastChannel("diagrams-oauth");
    channel.onmessage = (event: MessageEvent<unknown>) => {
      sessionStorage.setItem("received", JSON.stringify(event.data));
      channel.close();
    };
  });
  const callback = await context.newPage();
  await callback.addInitScript(() => {
    window.close = () => {};
    const Channel = BroadcastChannel;
    window.BroadcastChannel = class extends Channel {
      override postMessage(value: unknown) {
        sessionStorage.setItem("searchAtDelivery", location.search);
        super.postMessage(value);
      }
    };
  });
  await callback.goto("./auth.html?state=channel-state&code=channel-code");
  expect(await callback.evaluate(() => window.opener === null)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("received")))
    .toBe(
      JSON.stringify({
        type: "diagrams-oauth",
        params: { state: "channel-state", code: "channel-code" },
      }),
    );
  expect(await callback.evaluate(() => sessionStorage.getItem("searchAtDelivery"))).toBe("");
});

test("callback reaches the opener when BroadcastChannel throws", async ({ page, context }) => {
  await page.goto("./auth.html");
  await page.evaluate(() =>
    window.addEventListener("message", (event: MessageEvent<unknown>) => {
      sessionStorage.setItem(
        "received",
        JSON.stringify({ value: event.data, origin: event.origin, source: event.source !== null }),
      );
    }),
  );
  await context.addInitScript(() => {
    window.close = () => {};
    Object.defineProperty(window, "BroadcastChannel", {
      value: function () {
        throw new Error("unavailable");
      },
    });
    const opener = window.opener as Window | null;
    if (opener) {
      const deliver = opener.postMessage.bind(opener);
      opener.postMessage = (value: unknown, targetOrigin: string) => {
        sessionStorage.setItem("delivery", JSON.stringify({ search: location.search, targetOrigin }));
        deliver(value, targetOrigin);
      };
    }
  });
  const popup = page.waitForEvent("popup");
  await page.evaluate(() => window.open("./auth.html?state=opener-state&error=access_denied"));
  const callback = await popup;
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("received"))).not.toBeNull();
  const origin = new URL(page.url()).origin;
  expect(JSON.parse((await page.evaluate(() => sessionStorage.getItem("received"))) ?? "null")).toEqual({
    value: { type: "diagrams-oauth", params: { state: "opener-state", error: "access_denied" } },
    origin,
    source: true,
  });
  expect(JSON.parse((await callback.evaluate(() => sessionStorage.getItem("delivery"))) ?? "null")).toEqual({
    search: "",
    targetOrigin: origin,
  });
});
